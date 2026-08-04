import { load } from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';

import {
  AnimeParser,
  ISearch,
  IAnimeInfo,
  IAnimeResult,
  ISource,
  IAnimeEpisode,
  IEpisodeServer,
  ProxyConfig,
} from '../../models';
import { AxiosAdapter } from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

class AnimeSaturn extends AnimeParser {
  override readonly name = 'AnimeSaturn';
  protected override baseUrl = 'https://www.animesaturn.net/';
  protected override logo = 'https://www.animesaturn.net/assets/img/favicon/favicon-96x96.png';
  protected override classPath = 'ANIME.AnimeSaturn';
  public cookie: string = process.env.ANIMEUNITY_COOKIE || '';

  constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter) {
    super(proxyConfig, adapter);
    this.client.defaults.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
  }

  private activeProxyAgent: any = null;
  private proxiesList: string[] = [];
  private lastProxyFetchTime = 0;

  private async getProxyAgent(): Promise<any> {
    if (this.activeProxyAgent) return this.activeProxyAgent;

    const now = Date.now();
    if (this.proxiesList.length === 0 || now - this.lastProxyFetchTime > 300000) {
      try {
        const res = await axios.get('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', { timeout: 4000 });
        const proxies = res.data.split('\n').map((p: string) => p.trim()).filter(Boolean);
        if (proxies.length > 0) {
          this.proxiesList = proxies;
          this.lastProxyFetchTime = now;
        }
      } catch (e) {
        try {
          const res = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', { timeout: 6000 });
          const proxies = res.data.split('\r\n').filter(Boolean);
          if (proxies.length > 0) {
            this.proxiesList = proxies;
            this.lastProxyFetchTime = now;
          }
        } catch (err) {
          // ignore
        }
      }
    }

    if (this.proxiesList.length > 0) {
      const selectedProxy = this.proxiesList[Math.floor(Math.random() * Math.min(this.proxiesList.length, 30))];
      const [host, port] = selectedProxy.split(':');
      this.activeProxyAgent = {
        agent: new HttpsProxyAgent(`http://${selectedProxy}`),
        host,
        port: parseInt(port)
      };
      return this.activeProxyAgent;
    }
    return null;
  }

  private async requestSafe(url: string, config: any = {}): Promise<any> {
    if (this.activeProxyAgent) {
      try {
        return await axios.get(url, {
          ...config,
          headers: {
            ...config.headers,
            'Referer': config.headers?.Referer || config.headers?.referer || `${this.baseUrl}`,
            'User-Agent': config.headers?.['User-Agent'] || config.headers?.['user-agent'] || USER_AGENT,
          },
          httpAgent: this.activeProxyAgent.agent,
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
          proxy: {
            host: this.activeProxyAgent.host,
            port: this.activeProxyAgent.port,
          },
          timeout: 5000,
        });
      } catch (err) {
        if (this.activeProxyAgent) {
          const failedProxyStr = `${this.activeProxyAgent.host}:${this.activeProxyAgent.port}`;
          this.proxiesList = this.proxiesList.filter(p => p !== failedProxyStr);
        }
        this.activeProxyAgent = null;
      }
    }

    try {
      const directConfig = { ...config };
      if (!directConfig.httpsAgent) {
        directConfig.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
      }
      return await this.client.get(url, { ...directConfig, timeout: 3000 });
    } catch (err: any) {
      const isNetworkErr = 
        err.response?.status === 502 || 
        err.response?.status === 403 || 
        err.code === 'ECONNRESET' || 
        err.code === 'ETIMEDOUT' || 
        err.code === 'ENOTFOUND' || 
        err.message?.toLowerCase().includes('timeout') || 
        err.message?.toLowerCase().includes('certificate');

      if (isNetworkErr) {
        let lastError = err;
        for (let attempt = 0; attempt < 5; attempt++) {
          const proxyInfo = await this.getProxyAgent();
          if (proxyInfo) {
            try {
              const res = await axios.get(url, {
                ...config,
                headers: {
                  ...config.headers,
                  'Referer': config.headers?.Referer || config.headers?.referer || `${this.baseUrl}`,
                  'User-Agent': config.headers?.['User-Agent'] || config.headers?.['user-agent'] || USER_AGENT,
                },
                httpAgent: proxyInfo.agent,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                proxy: {
                  host: proxyInfo.host,
                  port: proxyInfo.port,
                },
                timeout: 5000,
              });
              this.activeProxyAgent = proxyInfo;
              return res;
            } catch (proxyErr) {
              if (this.activeProxyAgent) {
                const failedProxyStr = `${this.activeProxyAgent.host}:${this.activeProxyAgent.port}`;
                this.proxiesList = this.proxiesList.filter(p => p !== failedProxyStr);
              }
              this.activeProxyAgent = null;
              lastError = proxyErr;
            }
          }
        }
        throw lastError;
      }
      throw err;
    }
  }

  private dec(b: string, k: string): string {
    if (!b) return '';
    const s = Buffer.from(b, 'base64').toString('binary');
    let o = '';
    k = k || 'as';
    for (let i = 0; i < s.length; i++) {
      o += String.fromCharCode(s.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    return o;
  }

  /**
   * Search for anime
   * @param query Search query string
   * @returns Promise<ISearch<IAnimeResult>>
   */
  override search = async (query: string): Promise<ISearch<IAnimeResult>> => {
    const data = await this.requestSafe(`${this.baseUrl}filter?key=${query}`);
    const $ = await load(data.data);

    if (!$) return { results: [] };

    const res: {
      hasNextPage: boolean;
      results: IAnimeResult[];
    } = {
      hasNextPage: false,
      results: [],
    };

    $('a.ac.group').each((i, element) => {
      const item: IAnimeResult = {
        id: $(element).attr('href')?.split('/')?.pop() ?? '',
        title: $(element).find('h3.ac__title').text().trim(),
        image: $(element).find('img').attr('src'),
        url: `${this.baseUrl}anime/${$(element).attr('href')?.split('/')?.pop()}`,
      };

      if (!item.id) return;
      res.results.push(item);
    });
    return res;
  };

  /**
   * Fetch anime information
   * @param id Anime ID/slug
   * @returns Promise<IAnimeInfo>
   */
  override fetchAnimeInfo = async (id: string): Promise<IAnimeInfo> => {
    const data = await this.requestSafe(`${this.baseUrl}anime/${id}`);
    const $ = await load(data.data);

    let title = $('h1').text().trim();
    let image = $('div.ag-poster img').attr('src') || $('div.anime-poster-card img').attr('src');
    let description = '';

    try {
      const jsonLd = $('script[type="application/ld+json"]');
      jsonLd.each((i, el) => {
        const text = $(el).html();
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed['@type'] === 'TVSeries' || parsed['@type'] === 'Movie' || parsed['@type'] === 'TVEpisode') {
            if (!title) title = parsed.name || parsed.alternateName;
            if (!image) image = parsed.image;
            if (!description) description = parsed.description;
          }
        }
      });
    } catch (e) {
      // ignore
    }

    if (!title) {
      title = $('title').text().replace('Streaming ITA', '').replace('AnimeSaturn', '').replace(/[\s-]/g, ' ').trim();
    }

    const info: IAnimeInfo = {
      id,
      title,
      malID: $('a[href*="myanimelist.net/anime/"]').attr('href')?.split('/anime/')?.[1]?.split('/')?.[0],
      alID: $('a[href*="anilist.co/anime/"]').attr('href')?.split('/anime/')?.[1]?.split('/')?.[0],
      genres:
        $('a.chip[href*="categories="]')
          ?.map((i, element): string => {
            return $(element).text().trim();
          })
          .toArray() ?? undefined,
      image: image || undefined,
      cover: $('img.anime-hero__bg').attr('src') || undefined,
      description: description || undefined,
      episodes: [],
    };

    const episodes: IAnimeEpisode[] = [];

    $('a.ep-tile').each((i, element) => {
      const link = $(element).attr('href');
      const episodeNumber = $(element).text().trim();

      if (link) {
        episodes.push({
          number: parseInt(episodeNumber) || (i + 1),
          id: link.replace('/episode/', ''),
        });
      }
    });

    info.episodes = episodes.sort((a, b) => a.number - b.number);
    return info;
  };

  /**
   * Fetch episode video sources
   * @param episodeId Episode ID
   * @returns Promise<ISource>
   */
  override fetchEpisodeSources = async (episodeId: string): Promise<ISource> => {
    const episodeUrl = `${this.baseUrl}episode/${episodeId}`;
    const episodeRes = await this.requestSafe(episodeUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${this.baseUrl}`,
      }
    });

    const $episodePage = await load(episodeRes.data);
    let watchPath = $episodePage("a:contains('Guarda lo streaming')").attr('href');
    if (!watchPath) {
      watchPath = $episodePage("div:contains('Guarda lo streaming')").parent('a').attr('href');
    }
    if (!watchPath) {
      watchPath = $episodePage("a[href*='/anime/']").filter((i, el) => $episodePage(el).text().includes('Guarda')).attr('href');
    }

    const watchPageUrl = watchPath 
      ? (watchPath.startsWith('http') ? watchPath : `${this.baseUrl}${watchPath.replace(/^\//, '')}`)
      : `${this.baseUrl}anime/${episodeId}`;

    const watchPageData = await this.requestSafe(watchPageUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: episodeUrl,
      }
    });

    const $watchPage = await load(watchPageData.data);
    let iframeSrc = '';
    $watchPage('iframe').each((i, el) => {
      const src = $watchPage(el).attr('src');
      if (src && src.includes('play.saturncdn.net')) {
        iframeSrc = src;
      }
    });

    if (!iframeSrc) {
      iframeSrc = $watchPage('iframe').first().attr('src') || '';
    }

    if (!iframeSrc || !iframeSrc.includes('play.saturncdn.net')) {
      throw new Error('Player iframe not found or invalid');
    }

    const embedRes = await this.requestSafe(iframeSrc, {
      headers: {
        'Referer': watchPageUrl,
        'User-Agent': USER_AGENT,
      }
    });

    const embedHtml = embedRes.data;
    const match = embedHtml.match(/window\.__E\s*=\s*({[^}]+})/);
    if (!match) {
      throw new Error('window.__E not found in embed page');
    }

    const __E = JSON.parse(match[1].replace(/(\w+):/g, '"$1":'));

    const playlistUrl = `https://play.saturncdn.net/embed/${__E.i}/playlist?token=${encodeURIComponent(__E.k)}&expires=${__E.e}`;
    const playlistRes = await this.requestSafe(playlistUrl, {
      headers: {
        'Referer': iframeSrc,
        'User-Agent': USER_AGENT,
      }
    });

    const playlistJson = playlistRes.data;
    const decryptedSource = this.dec(playlistJson.d, __E.k);
    if (!decryptedSource) {
      throw new Error('Failed to decrypt video source');
    }

    const sources: ISource = {
      headers: {
        Referer: iframeSrc,
        'User-Agent': USER_AGENT,
      },
      subtitles: [],
      sources: [
        {
          url: decryptedSource,
          isM3U8: decryptedSource.includes('.m3u8'),
          quality: 'default',
        }
      ],
    };

    if (decryptedSource.includes('playlist.m3u8')) {
      sources.subtitles?.push({
        url: decryptedSource.replace('playlist.m3u8', 'subtitles.vtt'),
        lang: 'Italian',
      });
    }

    return sources;
  };

  /**
   * Fetch available episode servers
   * @param episodeId Episode ID
   * @returns Promise<IEpisodeServer[]>
   */
  override fetchEpisodeServers = async (episodeId: string): Promise<IEpisodeServer[]> => {
    try {
      const sources = await this.fetchEpisodeSources(episodeId);
      if (sources.sources && sources.sources.length > 0) {
        return [
          {
            name: 'SaturnCDN',
            url: sources.sources[0].url,
          }
        ];
      }
    } catch (e) {
      // ignore
    }
    return [];
  };
}

export default AnimeSaturn;

