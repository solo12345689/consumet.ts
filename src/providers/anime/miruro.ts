import axios from 'axios';
import zlib from 'zlib';

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

class Miruro extends AnimeParser {
  override readonly name = 'Miruro';
  protected override baseUrl = 'https://www.miruro.to';
  protected override logo = 'https://www.miruro.to/assets/logo-Dnw3w3dS.png?v=1.12.0';
  protected override classPath = 'ANIME.Miruro';

  private origins = [
    'https://www.miruro.ru',
    'https://www.miruro.to',
    'https://www.miruro.bz',
    'https://www.miruro.tv',
  ];

  private pipeObfKey = Buffer.from('71951034f8fbcf53d89db52ceb3dc22c', 'hex');

  private getHeaders(origin: string) {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="137", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      Referer: `${origin}/`,
      Origin: origin,
    };
  }

  private encodePipeRequest(payload: any): string {
    const json = JSON.stringify(payload);
    return Buffer.from(json).toString('base64url');
  }

  private translateId(encodedId: string): string {
    try {
      const padded = encodedId + '='.repeat((4 - (encodedId.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64url').toString('utf-8');
      if (decoded.includes(':')) return decoded;
      return encodedId;
    } catch {
      return encodedId;
    }
  }

  private deepTranslate(obj: any): any {
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj)) {
        return obj.map((item) => this.deepTranslate(item));
      }
      const clone = { ...obj };
      for (const key of Object.keys(clone)) {
        if (key === 'id' && typeof clone[key] === 'string') {
          if (clone.number !== undefined) {
            clone.rawPipeId = clone[key];
          }
          clone[key] = this.translateId(clone[key]);
        } else if (typeof clone[key] === 'object') {
          clone[key] = this.deepTranslate(clone[key]);
        }
      }
      return clone;
    }
    return obj;
  }

  private decodePipeResponse(encodedStr: string, obfHeader: any = null): any {
    try {
      if (!obfHeader) {
        return JSON.parse(encodedStr);
      }

      let padded = encodedStr + '='.repeat((4 - (encodedStr.length % 4)) % 4);
      const raw = Buffer.from(padded, 'base64url');

      let bytes = raw;
      if (String(obfHeader) === '2') {
        const xored = Buffer.alloc(raw.length);
        for (let i = 0; i < raw.length; i++) {
          xored[i] = raw[i] ^ this.pipeObfKey[i % this.pipeObfKey.length];
        }
        bytes = xored;
      }

      const decompressed = zlib.gunzipSync(bytes);
      return JSON.parse(decompressed.toString('utf-8'));
    } catch (e: any) {
      throw new Error('Failed to decode pipe response: ' + e.message);
    }
  }

  private async pipeRequest(path: string, query: any): Promise<any> {
    const payload = { path, method: 'GET', query, body: null };
    const encodedReq = this.encodePipeRequest(payload);
    let lastError: any = null;

    // 1. Try local/deployed Python proxy helper first (using the unified /pipe endpoint)
    const proxyUrl = process.env.MIRURO_PROXY_URL || 'http://127.0.0.1:8000';
    try {
      const res = await axios.get(`${proxyUrl}/pipe`, {
        params: { e: encodedReq },
        timeout: 20000,
      });
      if (res.status === 200 && res.data?.data) {
        const decoded = this.decodePipeResponse(res.data.data, res.data.obfuscated);
        return this.deepTranslate(decoded);
      }
    } catch (e) {
      // Fall back to direct request if proxy fails
    }

    // 2. Direct Node Axios fallback (as before)
    for (let attempt = 0; attempt < this.origins.length; attempt++) {
      const origin = this.origins[attempt];
      try {
        const res = await axios.get(`${origin}/api/secure/pipe?e=${encodedReq}`, {
          headers: this.getHeaders(origin),
          timeout: 20000,
        });

        if (res.status !== 200) {
          throw new Error(`Pipe request failed with status ${res.status}`);
        }

        const obf = res.headers['x-obfuscated'] || null;
        const decoded = this.decodePipeResponse(res.data, obf);
        return this.deepTranslate(decoded);
      } catch (err: any) {
        lastError = err;
      }
    }

    throw new Error(`All Miruro pipe mirrors failed. Last error: ${lastError?.message || lastError}`);
  }

  private async anilistQuery(query: string, variables: any = {}): Promise<any> {
    try {
      const res = await axios.post(
        'https://graphql.anilist.co',
        { query, variables },
        { headers: { 'Content-Type': 'application/json' } }
      );
      return res.data?.data || {};
    } catch (err: any) {
      throw new Error(`AniList query failed: ${err.message}`);
    }
  }

  override search = async (query: string, page: number = 1): Promise<ISearch<IAnimeResult>> => {
    const gql = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(search: $search, type: ANIME) {
            id
            title { romaji english native }
            coverImage { large extraLarge }
            bannerImage
            format
            status
            averageScore
            seasonYear
            genres
          }
        }
      }
    `;

    const data = await this.anilistQuery(gql, { search: query, page, perPage: 20 });
    const pageData = data.Page || {};
    const results: IAnimeResult[] = (pageData.media || []).map((item: any) => ({
      id: String(item.id),
      title: {
        romaji: item.title?.romaji || '',
        english: item.title?.english || '',
        native: item.title?.native || '',
      },
      image: item.coverImage?.large || item.coverImage?.extraLarge || '',
      cover: item.bannerImage || '',
      status: item.status || null,
      rating: item.averageScore || null,
      type: item.format || null,
      releaseDate: item.seasonYear || null,
      genres: item.genres || [],
    }));

    return {
      currentPage: pageData.pageInfo?.currentPage || page,
      hasNextPage: pageData.pageInfo?.hasNextPage || false,
      results,
    };
  };

  override fetchAnimeInfo = async (id: string): Promise<IAnimeInfo> => {
    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english native }
          description(asHtml: false)
          coverImage { large extraLarge color }
          bannerImage
          format
          season
          seasonYear
          episodes
          duration
          status
          averageScore
          genres
          studios(isMain: true) { nodes { name } }
        }
      }
    `;

    const anilistId = parseInt(id);
    const [metaData, pipeData] = await Promise.all([
      this.anilistQuery(gql, { id: anilistId }),
      this.pipeRequest('episodes', { anilistId }),
    ]);

    const media = metaData.Media;
    if (!media) {
      throw new Error('Anime not found on AniList');
    }

    const providers = pipeData.providers || {};
    const episodes: IAnimeEpisode[] = [];

    // Extract episodes from all providers and organize slug-based IDs
    for (const [provName, provData] of Object.entries(providers)) {
      const pData = provData as any;
      if (!pData || typeof pData !== 'object') continue;

      let eps = pData.episodes || {};
      if (Array.isArray(eps)) {
        eps = { sub: eps };
      }

      for (const [category, epList] of Object.entries(eps)) {
        if (!Array.isArray(epList)) continue;

        for (const ep of epList) {
          const rawId = ep.id || '';
          if (rawId && ep.number) {
            let customId = rawId;
            if (!rawId.startsWith('watch/')) {
              const prefix = rawId.includes(':') ? rawId.split(':')[0] : rawId;
              customId = `watch/${provName}/${anilistId}/${category}/${prefix}-${ep.number}`;
            }
            
            // Avoid duplicate episodes numbers in the default episodes list (prefer first found)
            if (!episodes.some((e) => e.number === ep.number)) {
              episodes.push({
                id: customId,
                number: ep.number,
                title: ep.title || `Episode ${ep.number}`,
                image: ep.image || '',
                airDate: ep.airDate || '',
                description: ep.description || '',
              });
            }
          }
        }
      }
    }

    // Sort episodes by number ascending
    episodes.sort((a, b) => a.number - b.number);

    return {
      id: String(media.id),
      title: {
        romaji: media.title?.romaji || '',
        english: media.title?.english || '',
        native: media.title?.native || '',
      },
      description: media.description || '',
      image: media.coverImage?.large || media.coverImage?.extraLarge || '',
      cover: media.bannerImage || '',
      status: media.status || null,
      rating: media.averageScore || null,
      type: media.format || null,
      genres: media.genres || [],
      episodes,
      providers, // Keep raw provider mappings for advanced lookups
    };
  };

  override fetchEpisodeSources = async (episodeId: string): Promise<ISource> => {
    // Expected episodeId format: [watch]/:provider/:anilistId/:category/:slug
    let parts = episodeId.split('/');
    if (parts[0] === 'watch') {
      parts.shift();
    }
    if (parts.length < 4) {
      throw new Error(`Invalid episode ID format: '${episodeId}'. Expected 'watch/:provider/:anilistId/:category/:slug'`);
    }

    const [provider, anilistIdStr, category, slug] = parts;
    const anilistId = parseInt(anilistIdStr);

    // Fetch the raw episodes to extract the matching rawPipeId
    const pipeData = await this.pipeRequest('episodes', { anilistId });
    const providers = pipeData.providers || {};
    const provData = providers[provider] || {};
    let eps = provData.episodes || {};
    if (Array.isArray(eps)) {
      eps = { sub: eps };
    }

    const epList = eps[category] || [];
    let targetId = null;

    for (const ep of epList) {
      const rawId = ep.id || '';
      let match = false;

      let cleanRawId = rawId;
      if (rawId.startsWith('watch/')) {
        const rParts = rawId.split('/');
        cleanRawId = rParts[rParts.length - 1];
      }

      if (cleanRawId.includes(':')) {
        const prefix = cleanRawId.split(':')[0];
        match = `${prefix}-${ep.number}` === slug;
      } else {
        match = cleanRawId === slug;
      }

      if (match) {
        targetId = (ep as any).rawPipeId ? this.translateId((ep as any).rawPipeId) : rawId;
        break;
      }
    }

    if (!targetId) {
      throw new Error(`Episode slug '${slug}' not found for provider '${provider}'`);
    }

    const encId = Buffer.from(targetId).toString('base64url');
    const sources = await this.pipeRequest('sources', {
      episodeId: encId,
      provider,
      category,
      anilistId,
    });

    return {
      sources: (sources.streams || []).map((s: any) => ({
        url: s.url || '',
        isM3U8: (s.url || '').includes('.m3u8'),
        quality: s.quality || 'default',
      })),
      subtitles: (sources.subtitles || []).map((sub: any) => ({
        url: sub.url || sub.file || '',
        lang: sub.label || 'English',
      })),
    };
  };

  override fetchEpisodeServers = async (episodeId: string): Promise<IEpisodeServer[]> => {
    throw new Error('Method not implemented.');
  };

  // --- Extra Miruro Specific Collection Methods ---

  fetchTrending = async (page: number = 1): Promise<any> => {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(sort: [TRENDING_DESC], type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            format
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { page, perPage: 20 });
  };

  fetchPopular = async (page: number = 1): Promise<any> => {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(sort: [POPULARITY_DESC], type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            format
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { page, perPage: 20 });
  };

  fetchUpcoming = async (page: number = 1): Promise<any> => {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(sort: [POPULARITY_DESC], status: NOT_YET_RELEASED, type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            format
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { page, perPage: 20 });
  };

  fetchRecent = async (page: number = 1): Promise<any> => {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(sort: [START_DATE_DESC], status: RELEASING, type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            format
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { page, perPage: 20 });
  };

  fetchSchedule = async (page: number = 1): Promise<any> => {
    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          airingSchedules(notYetAired: true, sort: TIME) {
            episode
            airingAt
            timeUntilAiring
            media {
              id
              title { romaji english native }
              coverImage { large }
            }
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { page, perPage: 20 });
  };

  fetchRecommendations = async (anilistId: number, page: number = 1): Promise<any> => {
    const gql = `
      query ($id: Int, $page: Int, $perPage: Int) {
        Media(id: $id, type: ANIME) {
          recommendations(sort: RATING_DESC, page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            nodes {
              rating
              mediaRecommendation {
                id
                title { romaji english native }
                coverImage { large }
              }
            }
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { id: anilistId, page, perPage: 15 });
  };

  fetchSpotlight = async (): Promise<any> => {
    const gql = `
      query {
        Page(page: 1, perPage: 10) {
          media(sort: [TRENDING_DESC, POPULARITY_DESC], type: ANIME) {
            id
            title { romaji english native }
            coverImage { large }
            format
          }
        }
      }
    `;
    return await this.anilistQuery(gql);
  };

  fetchFilter = async (options: {
    genre?: string;
    year?: number;
    format?: string;
    status?: string;
    sort?: string;
    page?: number;
    perPage?: number;
  }): Promise<any> => {
    const { genre, year, format, status, sort = 'POPULARITY_DESC', page = 1, perPage = 20 } = options;

    const args = ['type: ANIME', `sort: [${sort}]`];
    const variables: any = { page, perPage };

    if (genre) {
      args.push('genre: $genre');
      variables.genre = genre;
    }
    if (year) {
      args.push('seasonYear: $seasonYear');
      variables.seasonYear = year;
    }
    if (format) {
      args.push('format: $format');
      variables.format = format.toUpperCase();
    }
    if (status) {
      args.push('status: $status');
      variables.status = status.toUpperCase();
    }

    const varTypes = ['$page: Int', '$perPage: Int'];
    if (genre) varTypes.push('$genre: String');
    if (year) varTypes.push('$seasonYear: Int');
    if (format) varTypes.push('$format: MediaFormat');
    if (status) varTypes.push('$status: MediaStatus');

    const gql = `
      query (${varTypes.join(', ')}) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(${args.join(', ')}) {
            id
            title { romaji english native }
            coverImage { large extraLarge }
            bannerImage
            format
            season
            seasonYear
            episodes
            duration
            status
            averageScore
            genres
          }
        }
      }
    `;

    return await this.anilistQuery(gql, variables);
  };

  private injectSourceSlugs(data: any, anilistId: number): any {
    const providers = data.providers || {};
    for (const [provName, provData] of Object.entries(providers)) {
      const pData = provData as any;
      if (!pData || typeof pData !== 'object') continue;

      let eps = pData.episodes || {};
      if (Array.isArray(eps)) {
        eps = { sub: eps };
        pData.episodes = eps;
      }

      for (const [category, epList] of Object.entries(eps)) {
        if (!Array.isArray(epList)) continue;

        for (const ep of epList) {
          const rawId = ep.id || '';
          if (rawId && ep.number) {
            const prefix = rawId.includes(':') ? rawId.split(':')[0] : rawId;
            ep.id = `watch/${provName}/${anilistId}/${category}/${prefix}-${ep.number}`;
          }
        }
      }
    }
    return data;
  }

  fetchSuggestions = async (query: string): Promise<any> => {
    const gql = `
      query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english native }
            coverImage { large }
            format
            status
            startDate { year }
            episodes
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { search: query });
  };

  fetchCharacters = async (anilistId: number, page: number = 1, perPage: number = 25): Promise<any> => {
    const gql = `
      query ($id: Int, $page: Int, $perPage: Int) {
        Media(id: $id, type: ANIME) {
          id
          characters(sort: [ROLE, RELEVANCE], page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            edges {
              role
              node { id name { full native } image { large } }
              voiceActors(language: JAPANESE) { id name { full native } image { large } languageV2 }
            }
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { id: anilistId, page, perPage });
  };

  fetchRelations = async (anilistId: number): Promise<any> => {
    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                title { romaji english native }
                coverImage { large }
                format
                status
                episodes
              }
            }
          }
        }
      }
    `;
    return await this.anilistQuery(gql, { id: anilistId });
  };

  fetchEpisodesOnly = async (anilistId: number): Promise<any> => {
    const data = await this.pipeRequest('episodes', { anilistId });
    return this.injectSourceSlugs(data, anilistId);
  };
}

export default Miruro;
