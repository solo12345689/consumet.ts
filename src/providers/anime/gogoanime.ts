import { load } from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios, { AxiosAdapter } from 'axios';

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
import { USER_AGENT } from '../../utils';

class GogoAnime extends AnimeParser {
  override readonly name = 'GogoAnime';
  protected override baseUrl = 'https://www.gogoanime.is';
  protected override logo = 'https://www.gogoanime.is/img/logo.png';
  protected override classPath = 'ANIME.GogoAnime';

  constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter) {
    super(proxyConfig, adapter);
    this.client.defaults.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
  }

  private activeProxyAgent: any = null;

  /**
   * Fetches an active proxy from ProxyScrape and returns an HttpsProxyAgent
   */
  private async getProxyAgent(): Promise<any> {
    if (this.activeProxyAgent) return this.activeProxyAgent;
    try {
      const res = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=anonymous', { timeout: 6000 });
      const proxies = res.data.split('\r\n').filter(Boolean);
      if (proxies.length > 0) {
        const selectedProxy = proxies[Math.floor(Math.random() * Math.min(proxies.length, 10))];
        this.activeProxyAgent = new HttpsProxyAgent(`http://${selectedProxy}`);
        return this.activeProxyAgent;
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }

  /**
   * Request wrapper with SSL checks disabled
   */
  private async requestSafe(url: string, config: any = {}): Promise<any> {
    try {
      const directConfig = { ...config };
      if (!directConfig.httpsAgent) {
        directConfig.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
      }
      return await this.client.get(url, { ...directConfig, timeout: 5000 });
    } catch (err: any) {
      if (err.response?.status === 502 || err.code === 'ECONNRESET' || err.response?.status === 403 || err.message.includes('timeout') || err.message.includes('certificate')) {
        this.activeProxyAgent = null;
        let lastError = err;
        for (let attempt = 0; attempt < 5; attempt++) {
          const agent = await this.getProxyAgent();
          if (agent) {
            try {
              return await axios.get(url, {
                ...config,
                headers: {
                  ...config.headers,
                  'Referer': config.headers?.referer || `${this.baseUrl}/`,
                  'User-Agent': USER_AGENT,
                },
                httpAgent: agent,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                proxy: {
                  host: (agent as any).proxy.host,
                  port: parseInt((agent as any).proxy.port),
                },
                timeout: 8000,
              });
            } catch (proxyErr: any) {
              lastError = proxyErr;
              this.activeProxyAgent = null;
            }
          }
        }
        console.error('GogoAnime request failed after all proxy retries:', lastError.message);
        throw lastError;
      }
      console.error('GogoAnime request failed:', err.message);
      throw err;
    }
  }

  override search = async (query: string, page: number = 1): Promise<ISearch<IAnimeResult>> => {
    try {
      const res = await this.requestSafe(`${this.baseUrl}/search.html?keyword=${encodeURIComponent(query)}&page=${page}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      const $ = load(res.data);

      const results: IAnimeResult[] = [];

      $('div.last_episodes ul.items li').each((_, element) => {
        const titleEl = $(element).find('p.name a');
        const link = titleEl.attr('href') || '';
        const id = link.split('/').pop() || '';
        const title = titleEl.text().trim();
        const image = $(element).find('div.img a img').attr('src') || '';

        results.push({
          id,
          title,
          url: `${this.baseUrl}${link}`,
          image,
        });
      });

      return {
        results,
      };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchAnimeInfo = async (id: string): Promise<IAnimeInfo> => {
    try {
      const url = `${this.baseUrl}/category/${id}`;
      const res = await this.requestSafe(url, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      const $ = load(res.data);

      const title = $('div.anime_info_body_bg h1').text().trim();
      const image = $('div.anime_info_body_bg img').attr('src') || '';
      const description = $('div.anime_info_body_bg p.type').first().next().text().trim() || $('div.description').text().trim();

      const genres: string[] = [];
      $('div.anime_info_body_bg p:contains("Genre") a').each((_, el) => {
        genres.push($(el).text().trim());
      });

      const episodes: IAnimeEpisode[] = [];

      // Find episode range list
      const lastEpLink = $('ul.items li a').first().attr('href') || '';
      const parts = lastEpLink.split('-episode-');
      const maxEpisodes = parts.length > 1 ? parseInt(parts[1]) : 1;

      // Extract all relative episode links dynamically matching the pattern
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.startsWith(`/${id}-episode-`)) {
          const epNum = href.split('-episode-').pop() || '1';
          episodes.push({
            id: href.substring(1),
            number: parseInt(epNum) || 1,
            url: `${this.baseUrl}${href}`,
          });
        }
      });

      // Sort episodes by number ascending
      episodes.sort((a, b) => a.number - b.number);

      // Filter unique episode entries
      const uniqueEpisodes = episodes.filter((val, index, self) =>
        self.findIndex(t => t.id === val.id) === index
      );

      return {
        id,
        title,
        image,
        description,
        genres,
        episodes: uniqueEpisodes,
      };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchEpisodeSources = async (episodeId: string): Promise<ISource> => {
    try {
      const res = await this.requestSafe(`${this.baseUrl}/${episodeId}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      const $ = load(res.data);

      const sources: any[] = [];

      $('.anime_muti_link ul li').each((_, el) => {
        const serverName = $(el).attr('class') || '';
        const streamUrl = $(el).find('a').attr('data-video') || '';
        if (streamUrl) {
          sources.push({
            name: serverName,
            url: streamUrl,
            isM3U8: streamUrl.includes('.m3u8'),
          });
        }
      });

      return {
        sources,
      };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchEpisodeServers = async (episodeId: string): Promise<IEpisodeServer[]> => {
    throw new Error('Method not implemented.');
  };
}

export default GogoAnime;
