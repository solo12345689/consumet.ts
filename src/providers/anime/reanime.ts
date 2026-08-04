import axios from 'axios';
import crypto from 'crypto';

import {
  AnimeParser,
  ISearch,
  IAnimeInfo,
  IAnimeResult,
  ISource,
  IEpisodeServer,
  IAnimeEpisode,
} from '../../models';
import { USER_AGENT } from '../../utils';

class ReAnime extends AnimeParser {
  override readonly name = 'ReAnime';
  protected override baseUrl = 'https://reanime.to';
  protected override logo = 'https://reanime.to/assets/images/favicon/favicon.png';
  protected override classPath = 'ANIME.ReAnime';

  private sha256hex(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex');
  }

  private rt(b64: string): Buffer {
    return Buffer.from(b64, 'base64');
  }

  private le(seed: string) {
    let e = seed;
    for (let i = 0; i < 3; i++) e = this.sha256hex(e + i);
    let l = e;
    for (let i = 0; i < 3; i++) l = this.sha256hex(l + i);
    return {
      keyField: 'kf_' + e.substring(8, 16),
      ivField: 'ivf_' + e.substring(16, 24),
      containerName: 'cd_' + e.substring(24, 32),
      arrayName: 'ad_' + e.substring(32, 40),
      objectName: 'od_' + e.substring(40, 48),
      tokenField: e.substring(48, 64) + '_' + e.substring(56, 64),
      keyFrag2Field: l.substring(0, 16) + '_' + l.substring(16, 24),
    };
  }

  private async runWasm(
    wasmB64: string,
    frag1: Buffer,
    kf2: Buffer,
    T_bytes: Buffer,
    seedInt: number
  ): Promise<Buffer> {
    const wasmBuffer = this.rt(wasmB64);
    const { instance } = (await WebAssembly.instantiate(wasmBuffer)) as any;
    const exports = instance.exports as any;
    const { _s, _r, memory } = exports;
    const h = new Uint8Array(memory.buffer);
    const len = frag1.length;
    const [y, v, T, out] = [1000, 1000 + len, 1000 + 2 * len, 1000 + 3 * len];
    h.set(frag1, y);
    h.set(kf2, v);
    h.set(T_bytes, T);
    _s(seedInt);
    _r(y, v, T, out, len);
    return Buffer.from(h.subarray(out, out + len));
  }

  private extractSsrObj(html: string): string {
    const m = html.match(/\{type:"data",data:(\{)/);
    if (!m) throw new Error('SSR data block not found');
    let depth = 0;
    const start = html.indexOf('{', m.index! + m[0].length - 1);
    for (let i = start; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        if (--depth === 0) return html.slice(start, i + 1);
      }
    }
    throw new Error('SSR brace matching failed');
  }

  private async decryptFlixLink(linkUrl: string): Promise<any> {
    const embedRes = await axios.get(linkUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${this.baseUrl}/`,
      },
    });

    const html = embedRes.data;
    const objStr = this.extractSsrObj(html);
    const data = new Function(`return ${objStr}`)();

    const seed = data.obfuscation_seed;
    const fields = this.le(seed);
    const ocd = data.obfuscated_crypto_data;
    const obj = ocd[fields.containerName][fields.arrayName][0][fields.objectName];
    const frag1 = this.rt(obj[fields.keyField]);
    const iv = this.rt(obj[fields.ivField]);
    const kf2 = this.rt(data[fields.keyFrag2Field]);
    const token = data[fields.tokenField];

    if (!token) throw new Error('Token field missing from embed data');

    const tokenRes = await axios.get(`https://flixcloud.cc/api/m3u8/${token}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${this.baseUrl}/`,
      },
    });
    const tokData = tokenRes.data;

    const vidKey = this.sha256hex(token + 'vid').substring(0, 10);
    const keyKey = this.sha256hex(token + 'key').substring(0, 10);
    const v_bytes = this.rt(tokData[vidKey]);
    const T_bytes = this.rt(tokData[keyKey]);

    const wasmOut = await this.runWasm(
      data.w_payload,
      frag1,
      kf2,
      T_bytes,
      parseInt(seed.substring(0, 8), 16)
    );
    const pbk = crypto.pbkdf2Sync(wasmOut, seed, 1000, 32, 'sha256');
    const r = Buffer.from(pbk);
    for (let i = 0; i < 32; i++) r[i] ^= seed.charCodeAt(i % seed.length);
    const aesKey = crypto.createHash('sha256').update(r).digest();

    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    const decryptedUrl = Buffer.concat([
      decipher.update(v_bytes),
      decipher.final(),
    ]).toString('utf8').trim();

    return {
      url: decryptedUrl,
      subtitles: (data.subtitles || []).map((sub: any) => ({
        url: sub.url,
        lang: sub.language || 'English',
        format: sub.format || 'vtt',
      })),
      thumbnails_vtt: data.thumbnails_vtt || null,
      video_title: data.video_title || null,
    };
  }

  private extractAnilistId(anime: any): number | null {
    if (anime.anilist_id && anime.anilist_id !== 0) return anime.anilist_id;
    if (anime.anilist && anime.anilist !== 0) return anime.anilist;

    const coverUrl =
      anime.cover_image?.extra_large ||
      anime.cover_image?.large ||
      anime.cover_image?.medium ||
      '';
    const match = coverUrl.match(/\/bx(\d+)-/);
    return match ? parseInt(match[1]) : null;
  }

  private async searchAnilistId(title: string): Promise<number | null> {
    try {
      const res = await axios.post(
        'https://graphql.anilist.co',
        {
          query: `
            query ($search: String) {
              Media(search: $search, type: ANIME) {
                id
              }
            }
          `,
          variables: { search: title }
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      return res.data?.data?.Media?.id || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Search for anime
   * @param query Search query string
   * @returns Promise<ISearch<IAnimeResult>>
   */
  override search = async (query: string): Promise<ISearch<IAnimeResult>> => {
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&limit=30`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const results: IAnimeResult[] = (res.data.results || []).map((anime: any) => ({
        id: anime.anime_id,
        title: anime.title?.english || anime.title?.romaji || 'Unknown',
        image: anime.cover_image?.large || anime.cover_image?.medium || '',
        url: `${this.baseUrl}/watch/${anime.anime_id}`,
      }));
      return { results };
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch anime info and episode list
   * @param id Anime ID (slug)
   * @returns Promise<IAnimeInfo>
   */
  override fetchAnimeInfo = async (id: string): Promise<IAnimeInfo> => {
    try {
      const metaUrl = `${this.baseUrl}/api/v1/watch/${id}?ep=1`;
      const epUrl = `${this.baseUrl}/api/v1/anime/${id}/episodes?limit=2000`;

      const [metaRes, epRes] = await Promise.all([
        axios.get(metaUrl, { headers: { 'User-Agent': USER_AGENT } }),
        axios.get(epUrl, { headers: { 'User-Agent': USER_AGENT } }),
      ]);

      const anime = metaRes.data.anime || {};
      const anilistId = this.extractAnilistId(anime);
      const title = anime.title?.english || anime.title?.romaji || 'Unknown';

      const episodes: IAnimeEpisode[] = (epRes.data.data || []).map((ep: any) => ({
        id: `${id}/episode/${ep.episode_number}`,
        number: ep.episode_number,
        title: ep.title || `Episode ${ep.episode_number}`,
      }));

      return {
        id,
        title,
        genres: anime.genres || [],
        image: anime.cover_image?.extra_large || anime.cover_image?.large || '',
        description: anime.description || undefined,
        episodes,
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch episode video sources
   * @param episodeId Episode ID (slug/episode/number)
   * @returns Promise<ISource>
   */
  override fetchEpisodeSources = async (episodeId: string): Promise<ISource> => {
    // episodeId is e.g. claymore-hyk87h/episode/1
    const parts = episodeId.split('/episode/');
    const slug = parts[0];
    const epNum = parseInt(parts[1] || '1');

    try {
      // 1. Fetch watch metadata to retrieve the anime object and Anilist ID
      const watchUrl = `${this.baseUrl}/api/v1/watch/${slug}?ep=${epNum}`;
      const watchRes = await axios.get(watchUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      const anime = watchRes.data.anime || {};
      let anilistId = this.extractAnilistId(anime);
      if (!anilistId) {
        const titleStr = anime.title?.english || anime.title?.romaji || anime.title;
        if (titleStr) {
          anilistId = await this.searchAnilistId(titleStr);
        }
      }

      // 2. Fetch flix servers using Anilist ID
      let servers: any[] = [];
      if (anilistId) {
        const flixUrl = `${this.baseUrl}/api/flix/${anilistId}/${epNum}`;
        try {
          const flixRes = await axios.get(flixUrl, {
            headers: { 'User-Agent': USER_AGENT },
          });
          if (flixRes.data && flixRes.data.success) {
            servers = flixRes.data.servers || [];
          }
        } catch (err) {
          // ignore flix server error
        }
      }

      if (servers.length === 0) {
        throw new Error('No streaming servers found for this episode.');
      }

      // 3. Decrypt the first server dataLink
      const server = servers[0];
      const dec = await this.decryptFlixLink(server.dataLink);

      return {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: `${this.baseUrl}/`,
        },
        sources: [
          {
            url: dec.url,
            isM3U8: dec.url.includes('.m3u8'),
            quality: 'default',
          },
        ],
        subtitles: dec.subtitles || [],
      };
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch episode servers list
   * @param episodeId Episode ID (slug/episode/number)
   * @returns Promise<IEpisodeServer[]>
   */
  override fetchEpisodeServers = async (episodeId: string): Promise<IEpisodeServer[]> => {
    const parts = episodeId.split('/episode/');
    const slug = parts[0];
    const epNum = parseInt(parts[1] || '1');

    try {
      const watchUrl = `${this.baseUrl}/api/v1/watch/${slug}?ep=${epNum}`;
      const watchRes = await axios.get(watchUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });

      const anime = watchRes.data.anime || {};
      let anilistId = this.extractAnilistId(anime);
      if (!anilistId) {
        const titleStr = anime.title?.english || anime.title?.romaji || anime.title;
        if (titleStr) {
          anilistId = await this.searchAnilistId(titleStr);
        }
      }

      let servers: any[] = [];
      if (anilistId) {
        const flixUrl = `${this.baseUrl}/api/flix/${anilistId}/${epNum}`;
        try {
          const flixRes = await axios.get(flixUrl, {
            headers: { 'User-Agent': USER_AGENT },
          });
          if (flixRes.data && flixRes.data.success) {
            servers = flixRes.data.servers || [];
          }
        } catch (err) {
          // ignore
        }
      }

      return servers.map((s: any) => ({
        name: s.serverName || 'HD-1',
        url: s.dataLink,
      }));
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch airing schedule
   * @returns Promise<any>
   */
  fetchSchedule = async (): Promise<any> => {
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/schedule`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      return res.data;
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch latest aired episodes
   * @returns Promise<any>
   */
  fetchLatestEpisodes = async (): Promise<any> => {
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/home/latest-aired`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      return res.data;
    } catch (e: any) {
      throw new Error(e.message);
    }
  };

  /**
   * Fetch top anime charts
   * @param period 'day' | 'week' | 'month' (default: 'week')
   * @param limit limit number of results (default: 20)
   * @returns Promise<any>
   */
  fetchTopAnime = async (period: string = 'week', limit: number = 20): Promise<any> => {
    try {
      const res = await axios.get(
        `${this.baseUrl}/api/v1/top/anime?period=${period}&limit=${limit}`,
        {
          headers: { 'User-Agent': USER_AGENT },
        }
      );
      return res.data;
    } catch (e: any) {
      throw new Error(e.message);
    }
  };
}

export default ReAnime;
