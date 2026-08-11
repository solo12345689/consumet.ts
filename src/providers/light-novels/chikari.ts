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

class Chikari extends LightNovelParser {
  override readonly name = 'Chikari';
  protected override baseUrl = 'https://chikari.moe';
  private apiBaseUrl = 'https://chikari.moe/api';

  protected override logo = 'https://chikari.moe/favicon.ico';
  protected override classPath = 'LIGHT_NOVELS.Chikari';

  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * Search for novels on Chikari.
   * @param query search query string
   */
  override search = async (query: string): Promise<ISearch<ILightNovelResult>> => {
    const result: ISearch<ILightNovelResult> = { results: [] };

    try {
      const { data } = await axios.get(`${this.apiBaseUrl}/novels?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': this.userAgent },
      });

      const items = data.items || [];
      items.forEach((item: any) => {
        if (item.medium === 'novel') {
          result.results.push({
            id: item.slug,
            title: item.title,
            url: `${this.baseUrl}/novels/${item.slug}`,
            image: item.cover_url,
          });
        }
      });

      return result;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch novel details and all chapters (using pagination).
   * @param lightNovelUrl novel slug or full URL
   */
  override fetchLightNovelInfo = async (
    lightNovelUrl: string,
    chapterPage: number = -1
  ): Promise<ILightNovelInfo> => {
    let slug = lightNovelUrl;
    if (lightNovelUrl.startsWith(this.baseUrl)) {
      slug = lightNovelUrl.replace(`${this.baseUrl}/novels/`, '');
    } else if (lightNovelUrl.startsWith('/')) {
      slug = lightNovelUrl.substring(1);
    }
    slug = slug.replace(/\/$/, '');

    const lightNovelInfo: ILightNovelInfo = {
      id: slug,
      title: '',
      url: `${this.baseUrl}/novels/${slug}`,
    };

    try {
      const { data } = await axios.get(`${this.apiBaseUrl}/novels/${slug}`, {
        headers: { 'User-Agent': this.userAgent },
      });

      if (data.medium !== 'novel') {
        throw new Error('This series is not a novel.');
      }

      lightNovelInfo.title = data.title;
      lightNovelInfo.image = data.cover_url;
      lightNovelInfo.description = data.description;
      
      const genresList = (data.genres || []).map((g: any) => g.name);
      const tagsList = (data.tags || []).map((t: any) => t.name);
      lightNovelInfo.genres = [...new Set([...genresList, ...tagsList])];

      lightNovelInfo.author = (data.authors || []).map((a: any) => a.name).join(', ');

      const status = data.status?.toLowerCase() || '';
      if (status.includes('completed') || status.includes('complete')) {
        lightNovelInfo.status = MediaStatus.COMPLETED;
      } else if (status.includes('releasing') || status.includes('ongoing')) {
        lightNovelInfo.status = MediaStatus.ONGOING;
      } else {
        lightNovelInfo.status = MediaStatus.UNKNOWN;
      }

      // Fetch all chapters with offset loop
      const chapters: ILightNovelChapter[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const chaptersRes = await axios.get(`${this.apiBaseUrl}/novels/${slug}/chapters?limit=500&offset=${offset}`, {
          headers: { 'User-Agent': this.userAgent },
        });
        
        const pageItems = chaptersRes.data?.items || [];
        pageItems.forEach((ch: any) => {
          chapters.push({
            id: `${slug}/${ch.number}`,
            title: ch.title || `Chapter ${ch.number}`,
            url: `${this.baseUrl}/novels/${slug}/${ch.number}`,
          });
        });

        if (chapters.length >= chaptersRes.data.total || pageItems.length === 0) {
          hasMore = false;
        } else {
          offset += 500;
        }
      }

      // API returned chapters are newest-to-oldest; reverse to keep oldest-to-newest
      lightNovelInfo.chapters = chapters.reverse();

      return lightNovelInfo;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };

  /**
   * Fetch chapter contents.
   * @param chapterId chapter path containing slug/number
   */
  override fetchChapterContent = async (chapterId: string): Promise<ILightNovelChapterContent> => {
    let cleanId = chapterId;
    if (chapterId.startsWith('/')) {
      cleanId = chapterId.substring(1);
    }
    cleanId = cleanId.replace(/\/$/, '');

    const parts = cleanId.split('/');
    if (parts.length < 2) {
      throw new Error('Invalid chapter ID format. Expected novel-slug/chapter-number.');
    }

    const novelSlug = parts[0];
    const chapterNumber = parts[parts.length - 1];

    const contents: ILightNovelChapterContent = {
      novelTitle: '',
      chapterTitle: '',
      text: '',
    };

    try {
      const { data } = await axios.get(`${this.apiBaseUrl}/novels/${novelSlug}/chapters/${chapterNumber}/read`, {
        headers: { 'User-Agent': this.userAgent },
      });

      contents.chapterTitle = data.title;
      contents.novelTitle = data.novel_title || '';
      contents.text = data.body || '';

      return contents;
    } catch (err: any) {
      throw new Error(err.message);
    }
  };
}

export default Chikari;
