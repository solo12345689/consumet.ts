import { load } from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios, { AxiosAdapter } from 'axios';

import {
  AnimeParser,
  ISearch,
  IAnimeInfo,
  IAnimeResult,
  ISource,
  IEpisodeServer,
  SubOrSub,
  ProxyConfig,
  IAnimeEpisode,
} from '../../models';
import { USER_AGENT } from '../../utils';

class AnimeWorld extends AnimeParser {
  override readonly name = 'AnimeWorld';
  protected override baseUrl = 'https://www.animeworld.so';
  protected override logo = 'https://www.animeworld.so/assets/images/favicon/favicon.png';
  protected override classPath = 'ANIME.AnimeWorld';

  private activeProxyAgent: any = null;

  constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter) {
    super(proxyConfig, adapter);
    this.client.defaults.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
  }

  private async getProxyAgent(): Promise<any> {
    if (this.activeProxyAgent) return this.activeProxyAgent;
    try {
      const res = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=anonymous', { timeout: 6000 });
      const proxies = res.data.split('\r\n').filter(Boolean);
      if (proxies.length > 0) {
        const selectedProxy = proxies[Math.floor(Math.random() * Math.min(proxies.length, 10))];
        const [host, port] = selectedProxy.split(':');
        this.activeProxyAgent = {
          agent: new HttpsProxyAgent(`http://${selectedProxy}`),
          host,
          port: parseInt(port)
        };
        return this.activeProxyAgent;
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }

  /**
   * Safe request wrapper that tries via Proxy if direct requests fail
   */
  private async requestSafe(url: string, config: any = {}): Promise<any> {
    try {
      // First try direct connection
      const directConfig = { ...config };
      if (!directConfig.httpsAgent) {
        directConfig.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
      }
      return await this.client.get(url, { ...directConfig, timeout: 5000 });
    } catch (err: any) {
      if (err.response?.status === 502 || err.code === 'ECONNRESET' || err.response?.status === 403 || err.message.includes('timeout') || err.message.includes('certificate')) {
        // Clear active agent if the first direct call failed so we fetch fresh
        this.activeProxyAgent = null;
        let lastError = err;
        for (let attempt = 0; attempt < 5; attempt++) {
          const proxyInfo = await this.getProxyAgent();
          if (proxyInfo) {
            try {
              return await axios.get(url, {
                ...config,
                headers: {
                  ...config.headers,
                  'Referer': config.headers?.referer || `${this.baseUrl}/`,
                  'User-Agent': USER_AGENT,
                },
                httpAgent: proxyInfo.agent,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                proxy: {
                  host: proxyInfo.host,
                  port: proxyInfo.port,
                },
                timeout: 8000,
              });
            } catch (proxyErr: any) {
              lastError = proxyErr;
              // Try next proxy in the list on failure
              this.activeProxyAgent = null;
            }
          }
        }
        console.error('AnimeWorld request failed after all proxy retries:', lastError.message);
        throw lastError;
      }
      console.error('AnimeWorld request failed:', err.message);
      throw err;
    }
  }

  override search = async (query: string): Promise<ISearch<IAnimeResult>> => {
    try {
      const res = await this.requestSafe(`${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      const $ = load(res.data);

      const results: IAnimeResult[] = [];

      $('div.film-list div.item').each((_, element) => {
        const titleEl = $(element).find('a.name');
        const link = titleEl.attr('href') || '';
        const id = link.split('/').pop() || '';
        const title = titleEl.text().trim();
        const image = $(element).find('img').attr('src') || '';
        
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
      const url = `${this.baseUrl}/play/${id}`;
      const res = await this.requestSafe(url, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });
      const $ = load(res.data);

      const title = $('h1#anime-title').text().trim();
      const image = $('div#thumbnail-watch img').attr('src') || '';
      const description = $('div.descrizione').text().trim();

      const genres: string[] = [];
      $('div.info div.row dd').each((_, element) => {
        const txt = $(element).text().trim();
        if ($(element).prev().text().includes('Genere')) {
          txt.split(',').forEach(g => genres.push(g.trim()));
        }
      });

      const episodes: IAnimeEpisode[] = [];

      // Find AnimeWorld Server tab (usually class/data-name=9) or grab default tab
      const activeServerId = $('.servers-tabs .tab.active').attr('data-name') || '9';
      
      $(`div[class*='server'][data-name='${activeServerId}'] li.episode a`).each((_, element) => {
        const epNum = $(element).attr('data-episode-num') || '';
        const epDataId = $(element).attr('data-id') || '';
        
        episodes.push({
          id: `${id}/${epDataId}`,
          number: parseInt(epNum) || 1,
          url: `${this.baseUrl}${$(element).attr('href')}`,
        });
      });

      return {
        id,
        title,
        image,
        description,
        genres,
        episodes,
      };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchEpisodeSources = async (episodeId: string): Promise<ISource> => {
    try {
      const parts = episodeId.split('/');
      const animeId = parts[0];
      const dataId = parts[1];

      const res = await this.requestSafe(`${this.baseUrl}/api/episode/info?id=${dataId}&alt=0`, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `${this.baseUrl}/play/${animeId}`,
        },
      });

      const grabberUrl = res.data.grabber || '';

      return {
        sources: [
          {
            url: grabberUrl,
            isM3U8: grabberUrl.includes('.m3u8'),
          },
        ],
      };
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  override fetchEpisodeServers = async (episodeId: string): Promise<IEpisodeServer[]> => {
    throw new Error('Method not implemented.');
  };
}

export default AnimeWorld;
