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

class NovelBuddy extends LightNovelParser {
  override readonly name = 'NovelBuddy';
  protected override baseUrl = 'https://novelbuddy.me';
  private apiBaseUrl = 'https://api.novelbuddy.me';

  protected override logo = 'https://novelbuddy.me/favicon.ico';
  protected override classPath = 'LIGHT_NOVELS.NovelBuddy';

  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * Search for novels on NovelBuddy.
   * @param query search query string
   */
  override search = async (query: string): Promise<ISearch<ILightNovelResult>> => {
    const result: ISearch<ILightNovelResult> = { results: [] };

    try {
      const { data } = await axios.get(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': this.userAgent },
      });

      const $ = load(data);
      const nextDataHtml = $('#__NEXT_DATA__').html();
      if (!nextDataHtml) return result;

      const nextData = JSON.parse(nextDataHtml);
      const ssrItems = nextData.props?.pageProps?.ssrItems || [];

      ssrItems.forEach((item: any) => {
        result.results.push({
          id: item.slug || item.id,
          title: item.name,
          url: `${this.baseUrl}/${item.slug}`,
          image: item.cover,
        });
      });

      return result;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch novel details and all chapters.
   * @param lightNovelUrl light novel series slug or full URL
   */
  override fetchLightNovelInfo = async (
    lightNovelUrl: string,
    chapterPage: number = -1
  ): Promise<ILightNovelInfo> => {
    let slug = lightNovelUrl;
    if (lightNovelUrl.startsWith(this.baseUrl)) {
      slug = lightNovelUrl.replace(`${this.baseUrl}/`, '');
    } else if (lightNovelUrl.startsWith('/')) {
      slug = lightNovelUrl.substring(1);
    }

    const lightNovelInfo: ILightNovelInfo = {
      id: slug,
      title: '',
      url: `${this.baseUrl}/${slug}`,
    };

    try {
      const { data } = await axios.get(`${this.baseUrl}/${slug}`, {
        headers: { 'User-Agent': this.userAgent },
      });

      const $ = load(data);
      const nextDataHtml = $('#__NEXT_DATA__').html();
      if (!nextDataHtml) throw new Error('Failed to parse page data.');

      const nextData = JSON.parse(nextDataHtml);
      const initialManga = nextData.props?.pageProps?.initialManga;
      if (!initialManga) throw new Error('Novel details not found.');

      lightNovelInfo.title = initialManga.name;
      lightNovelInfo.image = initialManga.cover;
      lightNovelInfo.description = initialManga.summary || initialManga.description;
      const genresList = (initialManga.genres || []).map((g: any) => g.name);
      const tagsList = (initialManga.tags || []).map((t: any) => t.name || t);
      lightNovelInfo.genres = [...new Set([...genresList, ...tagsList])];
      lightNovelInfo.author = (initialManga.authors || []).map((a: any) => a.name).join(', ');

      const status = initialManga.status?.toLowerCase() || '';
      if (status.includes('completed') || status.includes('complete')) {
        lightNovelInfo.status = MediaStatus.COMPLETED;
      } else if (status.includes('ongoing')) {
        lightNovelInfo.status = MediaStatus.ONGOING;
      } else {
        lightNovelInfo.status = MediaStatus.UNKNOWN;
      }

      // Fetch all chapters from the internal API using the unique ID
      const chaptersRes = await axios.get(`${this.apiBaseUrl}/titles/${initialManga.id}/chapters`, {
        headers: { 'User-Agent': this.userAgent },
      });

      const rawChapters = chaptersRes.data?.data?.chapters || [];
      const chapters: ILightNovelChapter[] = [];

      rawChapters.forEach((ch: any) => {
        // ch.url is typically "/cultivation-online/chapter-2580-military-recruitment-3"
        // Strip leading slash for ID mapping
        const chId = ch.url.startsWith('/') ? ch.url.substring(1) : ch.url;
        chapters.push({
          id: chId,
          title: ch.name || `Chapter ${ch.number}`,
          url: `${this.baseUrl}/${chId}`,
        });
      });

      // NovelBuddy lists chapters from newest to oldest in the API; reverse to keep oldest to newest
      lightNovelInfo.chapters = chapters.reverse();

      return lightNovelInfo;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch chapter contents.
   * @param chapterId chapter path (e.g. cultivation-online/chapter-2580-military-recruitment-3)
   */
  override fetchChapterContent = async (chapterId: string): Promise<ILightNovelChapterContent> => {
    let cleanId = chapterId;
    if (chapterId.startsWith('/')) {
      cleanId = chapterId.substring(1);
    }

    const contents: ILightNovelChapterContent = {
      novelTitle: '',
      chapterTitle: '',
      text: '',
    };

    try {
      const { data } = await axios.get(`${this.baseUrl}/${cleanId}`, {
        headers: { 'User-Agent': this.userAgent },
      });

      const $ = load(data);
      const nextDataHtml = $('#__NEXT_DATA__').html();
      if (!nextDataHtml) throw new Error('Failed to parse chapter content.');

      const nextData = JSON.parse(nextDataHtml);
      const initialChapter = nextData.props?.pageProps?.initialChapter;
      if (!initialChapter) throw new Error('Chapter content not found.');

      contents.chapterTitle = initialChapter.name;
      contents.novelTitle = nextData.props?.pageProps?.initialManga?.name || '';

      const contentHtml = initialChapter.content || '';
      const content$ = load(contentHtml);
      
      const paragraphs: string[] = [];
      content$('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text) {
          paragraphs.push(text);
        }
      });

      // If no p tags, fallback to parsing raw body text
      if (paragraphs.length === 0) {
        contents.text = content$.text().trim();
      } else {
        contents.text = paragraphs.join('\n\n');
      }

      return contents;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };
}

export default NovelBuddy;
