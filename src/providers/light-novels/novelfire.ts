import { load } from 'cheerio';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

import {
  LightNovelParser,
  ISearch,
  ILightNovelInfo,
  ILightNovelChapter,
  ILightNovelChapterContent,
  ILightNovelResult,
  MediaStatus,
} from '../../models';

class NovelFire extends LightNovelParser {
  override readonly name = 'NovelFire';
  protected override baseUrl = 'https://novelfire.net';

  protected override logo = 'https://novelfire.net/favicon.ico';
  protected override classPath = 'LIGHT_NOVELS.NovelFire';

  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private activeProxyAgent: any = null;
  private proxiesList: string[] = [];
  private lastProxyFetchTime = 0;

  private async getProxyAgent(): Promise<any> {
    if (this.activeProxyAgent) return this.activeProxyAgent;

    const now = Date.now();
    if (this.proxiesList.length === 0 || now - this.lastProxyFetchTime > 300000) {
      try {
        const res = await axios.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US,DE,GB,CA&ssl=yes&anonymity=elite', { timeout: 6000 });
        const proxies = res.data.split('\r\n').map((p: string) => p.trim()).filter(Boolean);
        if (proxies.length > 0) {
          this.proxiesList = proxies;
          this.lastProxyFetchTime = now;
        }
      } catch (err) {
        try {
          const res = await axios.get('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', { timeout: 4000 });
          const proxies = res.data.split('\n').map((p: string) => p.trim()).filter(Boolean);
          if (proxies.length > 0) {
            this.proxiesList = proxies;
            this.lastProxyFetchTime = now;
          }
        } catch (e) {
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
    const headers = {
      ...config.headers,
      'User-Agent': this.userAgent,
      'Referer': config.headers?.Referer || config.headers?.referer || `${this.baseUrl}/`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // If we have an active proxy that worked, try using it first
    if (this.activeProxyAgent) {
      try {
        return await axios.get(url, {
          ...config,
          headers,
          httpAgent: this.activeProxyAgent.agent,
          httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
          proxy: {
            host: this.activeProxyAgent.host,
            port: this.activeProxyAgent.port,
          },
          timeout: 8000,
        });
      } catch (err) {
        if (this.activeProxyAgent) {
          const failedProxyStr = `${this.activeProxyAgent.host}:${this.activeProxyAgent.port}`;
          this.proxiesList = this.proxiesList.filter(p => p !== failedProxyStr);
        }
        this.activeProxyAgent = null;
      }
    }

    // Try direct connection first
    try {
      return await this.client.get(url, {
        ...config,
        headers,
        timeout: 5000,
      });
    } catch (err: any) {
      const isBlockOrNetworkErr = 
        err.response?.status === 403 || 
        err.response?.status === 401 || 
        err.response?.status === 502 || 
        err.code === 'ECONNRESET' || 
        err.code === 'ETIMEDOUT' || 
        err.message?.toLowerCase().includes('timeout');

      if (isBlockOrNetworkErr) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const proxyInfo = await this.getProxyAgent();
          if (proxyInfo) {
            try {
              const res = await axios.get(url, {
                ...config,
                headers,
                httpAgent: proxyInfo.agent,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                proxy: {
                  host: proxyInfo.host,
                  port: proxyInfo.port,
                },
                timeout: 8000,
              });
              // Success! Cache this working proxy
              return res;
            } catch (proxyErr) {
              const failedProxyStr = `${proxyInfo.host}:${proxyInfo.port}`;
              this.proxiesList = this.proxiesList.filter(p => p !== failedProxyStr);
              this.activeProxyAgent = null;
            }
          }
        }
      }
      throw err;
    }
  }

  /**
   * Search for novels on Novel Fire.
   * @param query search query string
   */
  override search = async (query: string): Promise<ISearch<ILightNovelResult>> => {
    const result: ISearch<ILightNovelResult> = { results: [] };

    try {
      const { data } = await this.requestSafe(`${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`);

      const $ = load(data);

      $('.novel-item').each((i, el) => {
        const anchor = $(el).find('a').first();
        const href = anchor.attr('href') || '';
        const id = href.split('/book/')[1];
        if (!id) return;

        const title = anchor.attr('title') || $(el).find('.novel-title').text().trim();
        const cover = anchor.find('img').attr('src') || '';
        
        result.results.push({
          id,
          title,
          url: `${this.baseUrl}/book/${id}`,
          image: cover.startsWith('http') ? cover : `${this.baseUrl}${cover}`,
        });
      });

      return result;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch novel details and all chapters (using page pagination).
   * @param lightNovelUrl novel slug or full URL
   */
  override fetchLightNovelInfo = async (
    lightNovelUrl: string,
    chapterPage: number = -1
  ): Promise<ILightNovelInfo> => {
    let slug = lightNovelUrl;
    if (lightNovelUrl.startsWith(this.baseUrl)) {
      slug = lightNovelUrl.replace(`${this.baseUrl}/book/`, '');
    } else if (lightNovelUrl.startsWith('/')) {
      slug = lightNovelUrl.substring(1);
    }
    slug = slug.replace(/\/$/, '');

    const lightNovelInfo: ILightNovelInfo = {
      id: slug,
      title: '',
      url: `${this.baseUrl}/book/${slug}`,
    };

    try {
      const { data } = await this.requestSafe(`${this.baseUrl}/book/${slug}`);

      const $ = load(data);

      lightNovelInfo.title = $('.novel-title').text().trim() || $('h1').text().trim();
      
      const cover = $('.novel-cover img').attr('src') || '';
      lightNovelInfo.image = cover.startsWith('http') ? cover : `${this.baseUrl}${cover}`;
      
      lightNovelInfo.description = $('.description').text().trim() || $('.summary').text().trim();

      const genres: string[] = [];
      $('.categories a, .genres a, .genre a').each((i, el) => {
        const text = $(el).text().trim();
        if (text) genres.push(text);
      });
      lightNovelInfo.genres = genres;

      let authorText = $('.author').text().trim();
      if (authorText.toLowerCase().startsWith('author:')) {
        authorText = authorText.replace(/author:/i, '').trim();
      }
      lightNovelInfo.author = authorText;

      const statusText = $('.header-stats').text().toLowerCase();
      if (statusText.includes('completed') || statusText.includes('complete')) {
        lightNovelInfo.status = MediaStatus.COMPLETED;
      } else if (statusText.includes('ongoing')) {
        lightNovelInfo.status = MediaStatus.ONGOING;
      } else {
        lightNovelInfo.status = MediaStatus.UNKNOWN;
      }

      // Fetch the first page of chapters to determine pagination total
      const pageOneUrl = `${this.baseUrl}/book/${slug}/chapters?page=1`;
      const pageOneRes = await this.requestSafe(pageOneUrl);
      const pageOne$ = load(pageOneRes.data);

      // Extract total page count from pagination links
      let maxPage = 1;
      pageOne$('.pagination a, .pagination-wrap a, a[href*="page="]').each((i, el) => {
        const text = $(el).text().trim();
        const pageNum = parseInt(text);
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      });

      // Fetch pages sequentially to avoid triggering 429 Rate Limiting blocks
      const chapters: ILightNovelChapter[] = [];
      for (let p = 1; p <= maxPage; p++) {
        const pageRes = await this.requestSafe(`${this.baseUrl}/book/${slug}/chapters?page=${p}`);
        const page$ = load(pageRes.data);
        page$('a').each((i, el) => {
          const href = page$(el).attr('href') || '';
          if (href.includes(`/book/${slug}/chapter-`)) {
            const chId = href.startsWith('/') ? href.substring(1) : href;
            const cleanChId = chId.replace('book/', '');
            
            if (!chapters.find(c => c.id === cleanChId)) {
              chapters.push({
                id: cleanChId,
                title: page$(el).text().trim(),
                url: `${this.baseUrl}/book/${cleanChId}`,
              });
            }
          }
        });
        // Tiny delay of 50ms to be polite to the hoster and prevent blocks
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // The site lists chapters descending (newest-to-oldest); reverse to keep oldest-to-newest
      lightNovelInfo.chapters = chapters.reverse();

      return lightNovelInfo;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch chapter contents.
   * @param chapterId chapter path (e.g. cultivation-online/chapter-1)
   */
  override fetchChapterContent = async (chapterId: string): Promise<ILightNovelChapterContent> => {
    let cleanId = chapterId;
    if (chapterId.startsWith('/')) {
      cleanId = chapterId.substring(1);
    }
    cleanId = cleanId.replace(/\/$/, '');

    const contents: ILightNovelChapterContent = {
      novelTitle: '',
      chapterTitle: '',
      text: '',
    };

    try {
      const { data } = await this.requestSafe(`${this.baseUrl}/book/${cleanId}`);

      const $ = load(data);

      contents.chapterTitle = $('.chapter-title').text().trim() || $('h1, h2').first().text().trim();
      contents.novelTitle = $('.booktitle').first().text().trim() || '';

      const paragraphs: string[] = [];
      $('#content p').each((i, el) => {
        const text = $(el).text().trim();
        if (text) paragraphs.push(text);
      });

      contents.text = paragraphs.join('\n\n');

      return contents;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };
}

export default NovelFire;
