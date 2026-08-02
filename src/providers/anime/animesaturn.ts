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

class AnimeSaturn extends AnimeParser {
  override readonly name = 'AnimeSaturn';
  protected override baseUrl = 'https://www.animesaturn.cx/';
  protected override logo = 'https://www.animesaturn.cx/immagini/favicon-32x32.png';
  protected override classPath = 'ANIME.AnimeSaturn';
  public cookie: string = process.env.ANIMEUNITY_COOKIE || '';

  constructor(proxyConfig?: ProxyConfig, adapter?: AxiosAdapter) {
    super(proxyConfig, adapter);
    this.client.defaults.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
  }

  private activeProxyAgent: any = null;

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
      // Fallback if proxy retrieval fails
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
      return await this.client.get(url, directConfig);
    } catch (err: any) {
      if (err.response?.status === 502 || err.code === 'ECONNRESET' || err.response?.status === 403 || err.message.includes('timeout') || err.message.includes('certificate')) {
        // Fetch/use proxy agent
        const proxyInfo = await this.getProxyAgent();
        if (proxyInfo) {
          try {
            return await axios.get(url, {
              ...config,
              httpAgent: proxyInfo.agent,
              httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
              proxy: {
                host: proxyInfo.host,
                port: proxyInfo.port,
              },
              timeout: 10000,
            });
          } catch (proxyErr) {
            // If proxy fails, clear active agent to fetch a new one next time
            this.activeProxyAgent = null;
            throw proxyErr;
          }
        }
      }
      console.error('AnimeSaturn direct request failed:', err.message);
      throw err;
    }
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

    const info: IAnimeInfo = {
      id,
      title: $('div.container.anime-title-as> b').text(),
      malID: $('a[href^="https://myanimelist.net/anime/"]').attr('href')?.slice(30, -1),
      alID: $('a[href^="https://anilist.co/anime/"]').attr('href')?.slice(25, -1),
      genres:
        $('div.container a.badge.badge-light')
          ?.map((i, element): string => {
            return $(element).text();
          })
          .toArray() ?? undefined,
      image: $('img.img-fluid')?.attr('src') || undefined,
      cover:
        $('div.banner')
          ?.attr('style')
          ?.match(/background:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1] || undefined,
      description: $('#full-trama').text(),
      episodes: [],
    };

    const episodes: IAnimeEpisode[] = [];

    $('.tab-pane.fade').each((i, element) => {
      $(element)
        .find('.bottone-ep')
        .each((i, element) => {
          const link = $(element).attr('href');
          const episodeNumber = $(element).text().trim().replace('Episodio ', '').trim();

          episodes.push({
            number: parseInt(episodeNumber),
            id: link?.split('/')?.pop() ?? '',
          });
        });
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
    const episodeData = await this.requestSafe(`${this.baseUrl}ep/${episodeId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: this.baseUrl,
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        Priority: 'u=0, i',
      },
    });

    const $episode = await load(episodeData.data);

    let watchUrl = $episode("a:contains('Guarda lo streaming')").attr('href');

    if (!watchUrl) {
      watchUrl = $episode("div:contains('Guarda lo streaming')").parent('a').attr('href');
    }

    if (!watchUrl) {
      watchUrl = $episode("a[href*='watch']").attr('href');
    }

    if (!watchUrl) {
      throw new Error('Watch URL not found');
    }

    const watchData = await this.requestSafe(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: `${this.baseUrl}ep/${episodeId}`,
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        Priority: 'u=0, i',
      },
    });

    const $watch = await load(watchData.data);

    const sources: ISource = {
      headers: {
        Referer: watchUrl,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
      },
      subtitles: [],
      sources: [],
    };

    $watch('video source').each((i, element) => {
      const src = $watch(element).attr('src');
      if (src && (src.includes('.mp4') || src.includes('.m3u8'))) {
        sources.sources.push({
          url: src,
          isM3U8: src.includes('.m3u8'),
          quality: 'default',
        });
      }
    });

    const videoSrc = $watch('video#myvideo').attr('src');
    if (videoSrc && (videoSrc.includes('.mp4') || videoSrc.includes('.m3u8'))) {
      if (!sources.sources.some(s => s.url === videoSrc)) {
        sources.sources.push({
          url: videoSrc,
          isM3U8: videoSrc.includes('.m3u8'),
          quality: 'default',
        });
      }
    }

    $watch('script').each((i, element) => {
      const scriptText = $watch(element).text();

      if (scriptText.includes('jwplayer') || scriptText.includes('file:')) {
        const lines = scriptText.split('\n');

        for (const line of lines) {
          if (line.includes('file:')) {
            let url = line.split('file:')[1].trim().replace(/['"]/g, '').replace(/,/g, '').trim();

            if (url && (url.includes('.mp4') || url.includes('.m3u8'))) {
              if (!sources.sources.some(s => s.url === url)) {
                sources.sources.push({
                  url: url,
                  isM3U8: url.includes('.m3u8'),
                  quality: 'default',
                });
              }
            }
          }
        }
      }

      const mp4Match = scriptText.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/g);
      if (mp4Match) {
        mp4Match.forEach(url => {
          if (!sources.sources.some(s => s.url === url)) {
            sources.sources.push({
              url: url,
              isM3U8: false,
              quality: 'default',
            });
          }
        });
      }

      const m3u8Match = scriptText.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
      if (m3u8Match) {
        m3u8Match.forEach(url => {
          if (!sources.sources.some(s => s.url === url)) {
            sources.sources.push({
              url: url,
              isM3U8: true,
              quality: 'default',
            });
          }
        });
      }
    });

    if (sources.sources.length === 0) {
      throw new Error('No video sources found');
    }

    const m3u8Source = sources.sources.find(s => s.isM3U8);
    if (m3u8Source && m3u8Source.url.includes('playlist.m3u8')) {
      sources.subtitles?.push({
        url: m3u8Source.url.replace('playlist.m3u8', 'subtitles.vtt'),
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
    const episodeData = await this.client.get(`${this.baseUrl}ep/${episodeId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        Referer: this.baseUrl,
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        Priority: 'u=0, i',
      },
    });

    const $episode = await load(episodeData.data);
    const servers: IEpisodeServer[] = [];

    const mainWatchUrl = $episode("a:contains('Guarda lo streaming')").attr('href');
    if (mainWatchUrl) {
      servers.push({
        name: 'Server 1',
        url: mainWatchUrl,
      });
    }

    if (mainWatchUrl) {
      const watchData = await this.client.get(mainWatchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          Referer: `${this.baseUrl}ep/${episodeId}`,
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-User': '?1',
          Priority: 'u=0, i',
        },
      });

      const $watch = await load(watchData.data);

      $watch('.dropdown-menu .dropdown-item').each((i, element) => {
        const serverUrl = $watch(element).attr('href');
        const serverName = $watch(element).text().trim();

        if (serverUrl && serverName && !servers.some(s => s.url === serverUrl)) {
          servers.push({
            name: serverName,
            url: serverUrl,
          });
        }
      });

      const altPlayerUrl = $watch("a:contains('Player alternativo')").attr('href');
      if (altPlayerUrl && !servers.some(s => s.url === altPlayerUrl)) {
        servers.push({
          name: 'Player Alternativo',
          url: altPlayerUrl,
        });
      }

      $watch('iframe').each((i, element) => {
        const src = $watch(element).attr('src');
        if (src && (src.includes('streamtape') || src.includes('mixdrop') || src.includes('doodstream'))) {
          const serverName = src.includes('streamtape')
            ? 'StreamTape'
            : src.includes('mixdrop')
            ? 'MixDrop'
            : src.includes('doodstream')
            ? 'DoodStream'
            : 'External Server';

          if (!servers.some(s => s.url === src)) {
            servers.push({
              name: serverName,
              url: src,
            });
          }
        }
      });
    }

    return servers;
  };
}

export default AnimeSaturn;
