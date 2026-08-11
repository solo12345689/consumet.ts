import { load } from 'cheerio';
import axios from 'axios';

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

  /**
   * Search for novels on Novel Fire.
   * @param query search query string
   */
  override search = async (query: string): Promise<ISearch<ILightNovelResult>> => {
    const result: ISearch<ILightNovelResult> = { results: [] };

    try {
      const { data } = await axios.get(`${this.baseUrl}/search?keyword=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': this.userAgent },
      });

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
      const { data } = await axios.get(`${this.baseUrl}/book/${slug}`, {
        headers: { 'User-Agent': this.userAgent },
      });

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
      const pageOneRes = await axios.get(pageOneUrl, {
        headers: { 'User-Agent': this.userAgent },
      });
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
        const pageRes = await axios.get(`${this.baseUrl}/book/${slug}/chapters?page=${p}`, {
          headers: { 'User-Agent': this.userAgent },
        });
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
      const { data } = await axios.get(`${this.baseUrl}/book/${cleanId}`, {
        headers: { 'User-Agent': this.userAgent },
      });

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
