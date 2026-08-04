import { CheerioAPI, load } from 'cheerio';

import {
  AnimeParser,
  ISearch,
  IAnimeInfo,
  IAnimeResult,
  ISource,
  IEpisodeServer,
  StreamingServers,
  MediaFormat,
  SubOrSub,
  IAnimeEpisode,
  MediaStatus,
  WatchListType,
} from '../../models';

import { MegaCloud, StreamSB, StreamTape } from '../../extractors';
import { USER_AGENT } from '../../utils';

class AniKoto extends AnimeParser {
  override readonly name = 'AniKoto';
  protected override baseUrl = 'https://anikoto.cz';
  protected override logo =
    'https://is3-ssl.mzstatic.com/image/thumb/Purple112/v4/7e/91/00/7e9100ee-2b62-0942-4cdc-e9b93252ce1c/source/512x512bb.jpg';
  protected override classPath = 'ANIME.AniKoto';

  /**
   * Search for anime
   * @param query Search query string
   * @param page Page number (default: 1)
   * @returns Promise<ISearch<IAnimeResult>>
   */
  override search(query: string, page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) {
      page = 1;
    }
    const searchUrl = `${this.baseUrl}/search?keyword=${decodeURIComponent(query)}&page=${page}`;
    return this.scrapeCardPage(searchUrl);
  }
  /**
   * Fetch advanced anime search results with various filters.
   *
   * @param page Page number (default: 1)
   * @param type One of (Optional): movie, tv, ova, ona, special, music
   * @param status One of (Optional): finished_airing, currently_airing, not_yet_aired
   * @param rated One of (Optional): g, pg, pg_13, r, r_plus, rx
   * @param score Number from 1 to 10 (Optional)
   * @param season One of (Optional): spring, summer, fall, winter
   * @param language One of (Optional): sub, dub, sub_dub
   * @param startDate Start date object { year, month, day } (Optional)
   * @param endDate End date object { year, month, day } (Optional)
   * @param sort One of (Optional): recently_added, recently_updated, score, name_az, released_date, most_watched
   * @param genres Array of genres (Optional): action, adventure, cars, comedy, dementia, demons, mystery, drama, ecchi, fantasy, game, historical, horror, kids, magic, martial_arts, mecha, music, parody, samurai, romance, school, sci_fi, shoujo, shoujo_ai, shounen, shounen_ai, space, sports, super_power, vampire, harem, military, slice_of_life, supernatural, police, psychological, thriller, seinen, isekai, josei
   * @returns A Promise resolving to the search results.
   */
  fetchAdvancedSearch(
    page: number = 1,
    type?: string,
    status?: string,
    rated?: string,
    score?: number,
    season?: string,
    language?: string,
    startDate?: { year: number; month: number; day: number },
    endDate?: { year: number; month: number; day: number },
    sort?: string,
    genres?: string[]
  ): Promise<ISearch<IAnimeResult>> {
    if (page <= 0) page = 1;

    const mappings: Record<string, Record<string, number>> = {
      type: { movie: 1, tv: 2, ova: 3, ona: 4, special: 5, music: 6 },
      status: { finished_airing: 1, currently_airing: 2, not_yet_aired: 3 },
      rated: { g: 1, pg: 2, pg_13: 3, r: 4, r_plus: 5, rx: 6 },
      season: { spring: 1, summer: 2, fall: 3, winter: 4 },
      language: { sub: 1, dub: 2, sub_dub: 3 },
      genre: {
        action: 1,
        adventure: 2,
        cars: 3,
        comedy: 4,
        dementia: 5,
        demons: 6,
        mystery: 7,
        drama: 8,
        ecchi: 9,
        fantasy: 10,
        game: 11,
        historical: 13,
        horror: 14,
        kids: 15,
        magic: 16,
        martial_arts: 17,
        mecha: 18,
        music: 19,
        parody: 20,
        samurai: 21,
        romance: 22,
        school: 23,
        sci_fi: 24,
        shoujo: 25,
        shoujo_ai: 26,
        shounen: 27,
        shounen_ai: 28,
        space: 29,
        sports: 30,
        super_power: 31,
        vampire: 32,
        harem: 35,
        military: 38,
        slice_of_life: 36,
        supernatural: 37,
        police: 39,
        psychological: 40,
        thriller: 41,
        seinen: 42,
        isekai: 44,
        josei: 43,
      },
    };

    const params = new URLSearchParams({ page: page.toString() });

    const addParam = (key: string, value?: string) => {
      if (value) params.append(key, (mappings[key]?.[value] || value).toString());
    };

    addParam('type', type);
    addParam('status', status);
    addParam('rated', rated);
    if (score) params.append('score', score.toString());
    addParam('season', season);
    addParam('language', language);

    if (startDate) {
      params.append('sy', startDate.year.toString());
      params.append('sm', startDate.month.toString());
      params.append('sd', startDate.day.toString());
    }

    if (endDate) {
      params.append('ey', endDate.year.toString());
      params.append('em', endDate.month.toString());
      params.append('ed', endDate.day.toString());
    }

    if (sort) params.append('sort', sort);

    if (genres?.length) {
      const genreIds = genres.map(genre => (mappings.genre[genre] || genre).toString()).join('%2C');
      params.append('genres', genreIds);
    }

    return this.scrapeCardPage(`${this.baseUrl}/filter?${params.toString()}`);
  }

  /**
   * @param page number
   */
  fetchTopAiring(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=top_airing&page=${page}`);
  }
  fetchMostPopular(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=most_watched&page=${page}`);
  }
  fetchMostFavorite(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=score&page=${page}`);
  }
  fetchLatestCompleted(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?status=completed&page=${page}`);
  }
  fetchRecentlyUpdated(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=recently_updated&page=${page}`);
  }
  fetchRecentlyAdded(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?sort=recently_added&page=${page}`);
  }
  fetchTopUpcoming(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?status=not_yet_aired&page=${page}`);
  }
  fetchSubbedAnime(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?lang=sub&page=${page}`);
  }
  fetchDubbedAnime(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?lang=dub&page=${page}`);
  }
  fetchMovie(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?type=movie&page=${page}`);
  }
  fetchTv(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?type=tv&page=${page}`);
  }
  fetchOva(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?type=ova&page=${page}`);
  }
  fetchOna(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?type=ona&page=${page}`);
  }
  fetchSpecial(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/filter?type=special&page=${page}`);
  }
  /**
   * @param studio Studio id, e.g. "toei-animation"
   * @param page page number (optional) `default 1`
   */
  fetchStudio(studio: string, page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) {
      page = 1;
    }
    return this.scrapeCardPage(`${this.baseUrl}/studio/${studio}?page=${page}`);
  }
  /**
   * @param letter Letter to filter by (a-z, 0-9)
   * @param page page number (optional) `default 1`
   */
  fetchAzList(letter: string = 'all', page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) {
      page = 1;
    }
    return this.scrapeCardPage(`${this.baseUrl}/az-list/${letter}?page=${page}`);
  }
  /**
   * @param id Anime ID or slug
   */
  async fetchWatchOrder(id: string): Promise<IAnimeResult[]> {
    try {
      const animeUrl = id.startsWith('http') ? id : `${this.baseUrl}/watch/${id}`;
      const { data } = await this.client.get(animeUrl);
      const $ = load(data);
      const related: IAnimeResult[] = [];

      $('#w-related .item, .w-side-section .item').each((i: number, el: any) => {
        const card = $(el);
        let aTag: any = card.find('a').first();
        let href = aTag.attr('href');
        if (!href) {
          aTag = card.closest('a') as any;
          href = aTag.attr('href');
        }
        if (href) {
          const relId = href.split('/watch/').pop() || href.split('/')[1]?.split('?')[0];
          if (relId) {
            related.push({
              id: relId,
              title: card.find('.name, a.name').text().trim() || card.find('img').attr('alt') || aTag.text().trim(),
              url: href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`,
              image: card.find('img')?.attr('src') || card.find('img')?.attr('data-src'),
              type: card.find('.relation, .serieslabelitem, .meta .dot').eq(1)?.text()?.trim() as MediaFormat,
            });
          }
        }
      });
      return related;
    } catch (err) {
      return [];
    }
  }
  /**
   * @param episodeId Episode ID or slug
   */
  async fetchDownloadLinks(episodeId: string): Promise<{ downloadUrl: string; headers?: Record<string, string> }> {
    try {
      const sources = await this.fetchEpisodeSources(episodeId);
      const m3u8Url = sources.sources?.[0]?.url;
      if (m3u8Url) {
        return {
          downloadUrl: m3u8Url,
          headers: sources.headers || { Referer: 'https://megaplay.buzz/' }
        };
      }
      
      const watchSlug = episodeId.split('$episode$')[0];
      const epNum = episodeId.split('$episode$')[1] || '1';
      const watchUrl = `${this.baseUrl}/watch/${watchSlug}/ep-${epNum}`;
      return {
        downloadUrl: watchUrl,
        headers: { Referer: this.baseUrl }
      };
    } catch (err) {
      throw new Error('Download link not found');
    }
  }
  fetchTV(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/tv?page=${page}`);
  }
  fetchOVA(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ova?page=${page}`);
  }
  fetchONA(page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (0 >= page) page = 1;
    return this.scrapeCardPage(`${this.baseUrl}/ona?page=${page}`);
  }

  async fetchGenres(): Promise<string[]> {
    try {
      const res: string[] = [];
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      $('a[href*="/genre/"]').each((i, ele) => {
        const genre = $(ele).text().trim().toLowerCase();
        if (genre && genre !== 'unknown' && !res.includes(genre)) {
          res.push(genre);
        }
      });

      return res;
    } catch (err) {
      throw new Error('Something went wrong. Please try again later.');
    }
  }
  /**
   * @param page number
   */
  genreSearch(genre: string, page: number = 1): Promise<ISearch<IAnimeResult>> {
    if (genre == '') {
      throw new Error('genre is empty');
    }
    if (0 >= page) {
      page = 1;
    }
    return this.scrapeCardPage(`${this.baseUrl}/genre/${genre}?page=${page}`);
  }

  async fetchSchedule(date: string = new Date().toISOString().slice(0, 10)): Promise<ISearch<IAnimeResult>> {
    try {
      const res: ISearch<IAnimeResult> = { results: [] };
      const timestamp = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
      const { data } = await this.client.get(`${this.baseUrl}/ajax/schedule/date?tz=5.5&time=${timestamp}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const htmlContent = data.result || data.html || data;
      const $ = load(htmlContent);

      $('a.item, .schedule-item, ul.schedule-list li').each((i: number, ele: any) => {
        const card = $(ele);
        const aTag = card.is('a') ? card : card.find('a.name, .film-name a, a').first();
        const href = aTag.attr('href') || '';
        const id = href.split('/watch/').pop() || href.split('/')[1]?.split('?')[0];

        if (id) {
          res.results.push({
            id: id,
            title: card.find('.title').text().trim() || aTag.text().trim(),
            japaneseTitle: card.find('.title').attr('data-jp') || aTag.attr('data-jp') || aTag.attr('data-jname'),
            url: href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`,
            airingEpisode: card.find('.ep, .episode').text().trim(),
            airingTime: card.find('.time').text().trim(),
          });
        }
      });

      return res;
    } catch (err) {
      return { results: [] };
    }
  }

  async fetchSpotlight(): Promise<ISearch<IAnimeResult>> {
    try {
      const res: ISearch<IAnimeResult> = { results: [] };
      const { data } = await this.client.get(`${this.baseUrl}/home`);
      const $ = load(data);

      $('.des-item, #slider .swiper-slide, .item').each((i: number, el: any) => {
        const card = $(el);
        const aTag = card.find('a.name, .desi-head-title, a').first();
        const href = aTag.attr('href') || '';
        const id = href.split('/watch/').pop() || href.split('/')[1]?.split('?')[0];

        if (id) {
          res.results.push({
            id: id,
            title: aTag.text().trim(),
            japaneseTitle: aTag.attr('data-jp') || aTag.attr('data-jname'),
            banner: card.find('img')?.attr('src') || card.find('img')?.attr('data-src'),
            url: `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`,
          });
        }
      });

      return res;
    } catch (error) {
      return { results: [] };
    }
  }

  async fetchSearchSuggestions(query: string): Promise<ISearch<IAnimeResult>> {
    try {
      const encodedQuery = encodeURIComponent(query);
      const { data } = await this.client.get(`${this.baseUrl}/search?keyword=${encodedQuery}`);
      const $ = load(data);
      const res: ISearch<IAnimeResult> = {
        results: await this.scrapeCard($),
      };
      return res;
    } catch (error) {
      return { results: [] };
    }
  }

  /**
   * Fetches the list of episodes that the user is currently watching.
   * @param connectSid The session ID of the user. Note: This can be obtained from the browser cookies (needs to be signed in)
   * @returns A promise that resolves to an array of anime episodes.
   */
  async fetchContinueWatching(connectSid: string): Promise<IAnimeEpisode[]> {
    try {
      if (!(await this.verifyLoginState(connectSid))) {
        throw new Error('Invalid session ID');
      }
      const res: IAnimeEpisode[] = [];
      const { data } = await this.client.get(`${this.baseUrl}/user/continue-watching`, {
        headers: {
          Cookie: `connect.sid=${connectSid}`,
        },
      });
      const $ = load(data);
      $('.flw-item').each((i, ele) => {
        const card = $(ele);
        const atag = card.find('.film-name a');
        const id = atag.attr('href')?.replace('/watch/', '')?.replace('?ep=', '$episode$');
        const timeText = card.find('.fdb-time')?.text()?.split('/') ?? [];
        const duration = timeText.pop()?.trim() ?? '';
        const watchedTime = timeText.length > 0 ? timeText[0].trim() : '';
        res.push({
          id: id!,
          title: atag.text(),
          number: parseInt(card.find('.fdb-type').text().replace('EP', '').trim()),
          duration: duration,
          watchedTime: watchedTime,
          url: `${this.baseUrl}${atag.attr('href')}`,
          image: card.find('img')?.attr('data-src'),
          japaneseTitle: atag.attr('data-jname'),
          nsfw: card.find('.tick-rate')?.text() === '18+' ? true : false,
          sub: parseInt(card.find('.tick-item.tick-sub')?.text()) || 0,
          dub: parseInt(card.find('.tick-item.tick-dub')?.text()) || 0,
          episodes: parseInt(card.find('.tick-item.tick-eps')?.text()) || 0,
        });
      });

      return res;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }

  async fetchWatchList(
    connectSid: string,
    page: number = 1,
    sortListType?: WatchListType
  ): Promise<ISearch<IAnimeResult>> {
    if (!(await this.verifyLoginState(connectSid))) {
      throw new Error('Invalid session ID');
    }
    if (0 >= page) {
      page = 1;
    }
    let type: number = 0;
    switch (sortListType) {
      case WatchListType.WATCHING:
        type = 1;
      case WatchListType.ONHOLD:
        type = 2;
      case WatchListType.PLAN_TO_WATCH:
        type = 3;
      case WatchListType.DROPPED:
        type = 4;
      case WatchListType.COMPLETED:
        type = 5;
    }
    return this.scrapeCardPage(
      `${this.baseUrl}/user/watch-list?page=${page}${type != 0 ? '&type=' + type : ''}`,
      {
        headers: { Cookie: `connect.sid=${connectSid}` },
      }
    );
  }
  /**
   * Fetch anime information
   * @param id Anime ID/slug
   * @returns Promise<IAnimeInfo>
   */
  override fetchAnimeInfo = async (id: string): Promise<IAnimeInfo> => {
    const info: IAnimeInfo = {
      id: id,
      title: '',
    };
    try {
      const animeUrl = id.startsWith('http') ? id : `${this.baseUrl}/watch/${id}`;
      const { data } = await this.client.get(animeUrl);
      const $ = load(data);

      try {
        const syncText = $('#syncData').text();
        if (syncText) {
          const { mal_id, anilist_id } = JSON.parse(syncText);
          info.malID = Number(mal_id);
          info.alID = Number(anilist_id);
        }
      } catch (e) {}

      info.title = $('h1.title.d-title, h2.film-name > a.text-white').first().text().trim() || $('title').text().split('-')[0].trim();
      info.japaneseTitle = $('h1.title.d-title').attr('data-jp') || $('div.anisc-info div:nth-child(2) span.name').text().trim();
      info.image = $('img[itemprop="image"], img.film-poster-img').attr('src');
      info.description = $('.synopsis .content, div.film-description').text().trim();
      info.type = ($('.bmeta .meta:first-child > div:nth-child(1) span').text().trim() || $('span.item').last().prev().prev().text().trim()).toUpperCase() as MediaFormat;
      info.url = animeUrl;
      info.recommendations = [];
      info.relatedAnime = [];

      // recommendations is the Recommended section on the sidebar
      const recommendedSection = $('.w-side-section').filter((i, el) => $(el).find('h2, h3, .title').text().includes('Recommended'));
      recommendedSection.find('.item').each((i, el) => {
        const card = $(el);
        const href = card.attr('href') || '';
        let relId = href.split('/watch/').pop()?.split('?')[0] || '';
        if (relId.includes('/ep-')) {
          relId = relId.split('/ep-')[0];
        }
        if (relId) {
          const title = card.find('.name, a.name').text().trim() || card.find('img').attr('alt') || '';
          info.recommendations?.push({
            id: relId,
            title: title,
            url: href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`,
            image: card.find('img').attr('src') || card.find('img').attr('data-src'),
            type: card.find('.meta span.dot, .dot').first().text().trim() as MediaFormat,
          });
        }
      });

      // relatedAnime is the Trending section on the sidebar
      const trendingSection = $('.w-side-section').filter((i, el) => $(el).find('h2, h3, .title').text().includes('Trending'));
      trendingSection.find('.item').each((i, el) => {
        const card = $(el);
        const href = card.attr('href') || '';
        let relId = href.split('/watch/').pop()?.split('?')[0] || '';
        if (relId.includes('/ep-')) {
          relId = relId.split('/ep-')[0];
        }
        if (relId) {
          const title = card.find('.name, a.name').text().trim() || card.find('img').attr('alt') || '';
          info.relatedAnime?.push({
            id: relId,
            title: title,
            url: href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`,
            image: card.find('img').attr('src') || card.find('img').attr('data-src'),
            type: card.find('.meta span.dot, .dot').first().text().trim() as MediaFormat,
          });
        }
      });

      const subCount = parseInt($('.ep-status.sub span, div.tick-item.tick-sub').first().text().trim()) || 0;
      const dubCount = parseInt($('.ep-status.dub span, div.tick-item.tick-dub').first().text().trim()) || 0;

      if (subCount > 0) info.hasSub = true;
      if (dubCount > 0) info.hasDub = true;
      if (subCount > 0 && dubCount > 0) info.subOrDub = SubOrSub.BOTH;
      else if (dubCount > 0) info.subOrDub = SubOrSub.DUB;
      else info.subOrDub = SubOrSub.SUB;

      info.genres = [];
      $('.bmeta a[href*="/genre/"], .item.item-list a').each((_, el) => {
        const genre = $(el).text().trim();
        if (genre) info.genres?.push(genre);
      });

      const statusText = $('.bmeta .meta:first-child > div:nth-child(4) span a').text().trim() || $('span.item-head:contains("Status")').next('span.name').text().trim();
      if (statusText.toLowerCase().includes('finished')) info.status = MediaStatus.COMPLETED;
      else if (statusText.toLowerCase().includes('currently')) info.status = MediaStatus.ONGOING;
      else if (statusText.toLowerCase().includes('not yet')) info.status = MediaStatus.NOT_YET_AIRED;
      else info.status = MediaStatus.UNKNOWN;

      const animeId = parseInt($('#watch-main').attr('data-id') || '') || 0;

      info.episodes = [];
      if (animeId > 0) {
        try {
          const ajaxRes = await this.client.get(`${this.baseUrl}/ajax/episode/list/${animeId}`, {
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              Referer: animeUrl,
            },
          });
          const raw = ajaxRes.data;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const html = parsed?.result || parsed?.html || '';
          const $$ = load(html);

          $$('a.ep-item, li[data-html] a').each((i: number, el: any) => {
            const a = $$(el);
            const href = a.attr('href') || '';
            const epNum = parseInt(a.attr('data-num') || a.attr('data-number') || '') || (i + 1);
            let epSlug = `${id}$episode$${epNum}`;
            if (href && href.includes('/watch/')) {
              epSlug = href.split('/watch/').pop()?.replace('/ep-', '$episode$') || epSlug;
            }

             info.episodes?.push({
              id: epSlug,
              number: epNum,
              title: a.attr('title') || a.find('.d-title').text().trim() || `Episode ${epNum}`,
              url: (!href || href === '#') ? `${this.baseUrl}/watch/${id}/ep-${epNum}` : (href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`),
            });
          });
        } catch (ajaxErr) {}
      }

      if (info.episodes.length === 0) {
        const episodeElements = $('#episodes-list a, div.detail-infor-content > div > a, .ep-item');
        if (episodeElements.length > 0) {
          episodeElements.each((i: number, el: any) => {
            const href = $(el).attr('href') || '';
            const epNumStr = $(el).attr('data-number') || $(el).text().trim().replace(/\D+/g, '') || `${i + 1}`;
            const number = parseInt(epNumStr) || (i + 1);
            const epId = href.includes('/watch/') ? href.split('/watch/').pop()?.replace('/ep-', '$episode$') : href.split('?ep=').pop();

            info.episodes?.push({
              id: epId || `${id}$episode$${number}`,
              number: number,
              title: $(el).attr('title') || `Episode ${number}`,
              url: (!href || href === '#') ? `${this.baseUrl}/watch/${id}/ep-${number}` : (href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`),
            });
          });
        }
      }

      info.totalEpisodes = info.episodes.length;
      return info;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  /**
   * Fetch episode video sources
   * @param episodeId Episode ID
   * @param server Server type (default: VidCloud)
   * @param subOrDub Sub or dub preference (default: SUB)
   * @returns Promise<ISource>
   */
  override fetchEpisodeSources = async (
    episodeId: string,
    server?: StreamingServers,
    subOrDub: SubOrSub = SubOrSub.SUB
  ): Promise<any> => {
    if (episodeId.startsWith('http')) {
      const serverUrl = new URL(episodeId);
      switch (server) {
        case StreamingServers.VidStreaming:
        case StreamingServers.VidCloud:
          return {
            headers: { Referer: serverUrl.href },
            sub: await new MegaCloud().extract(serverUrl),
          };
        case StreamingServers.StreamSB:
          return {
            headers: {
              Referer: serverUrl.href,
              watchsb: 'streamsb',
              'User-Agent': USER_AGENT,
            },
            sub: {
              sources: await new StreamSB(this.proxyConfig, this.adapter).extract(serverUrl, true),
            }
          };
        case StreamingServers.StreamTape:
          return {
            headers: { Referer: serverUrl.href, 'User-Agent': USER_AGENT },
            sub: {
              sources: await new StreamTape(this.proxyConfig, this.adapter).extract(serverUrl),
            }
          };
        default:
        case StreamingServers.VidCloud:
          return {
            headers: { Referer: serverUrl.href },
            sub: await new MegaCloud().extract(serverUrl),
          };
      }
    }
    if (!episodeId.includes('$episode$') && !episodeId.includes('link-') && !episodeId.startsWith('http')) {
      episodeId = `${episodeId}$episode$1`;
    }

    try {
      let embedUrl = '';
      let linkId = episodeId;
      
      // Convert standard /ep-X or watch/ep-X formats into the internal watchSlug$episode$epNum format
      if (!episodeId.includes('$episode$') && episodeId.includes('/ep-')) {
        const parts = episodeId.split('/ep-');
        const watchSlug = parts[0].split('/').pop() || parts[0];
        const epNum = parts[1].split('?')[0];
        episodeId = `${watchSlug}$episode$${epNum}`;
      } else if (!episodeId.includes('$episode$')) {
        episodeId = `${episodeId}$episode$1`;
      }

      if (episodeId.includes('$episode$')) {
        const watchSlug = episodeId.split('$episode$')[0];
        const epNum = episodeId.split('$episode$')[1];

        const animeRes = await this.client.get(`${this.baseUrl}/watch/${watchSlug}`);
        const $anime = load(animeRes.data);
        const animeId = parseInt($anime('#watch-main').attr('data-id') || '') || 0;

        if (animeId > 0) {
          const listRes = await this.client.get(`${this.baseUrl}/ajax/episode/list/${animeId}`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          const parsed = typeof listRes.data === 'string' ? JSON.parse(listRes.data) : listRes.data;
          const $$ = load(parsed?.result || parsed?.html || '');
          const targetA = $$(`a[data-num="${epNum}"]`).first();
          if (!targetA.length) {
            const allA = $$('a[data-id], a.ep-item');
            const targetAAlt = allA.eq(parseInt(epNum) - 1);
            linkId = targetAAlt.attr('data-id') || targetAAlt.attr('data-ids') || linkId;
          } else {
            const epDataIds = targetA.attr('data-ids') || targetA.attr('data-id') || '';
            if (epDataIds) {
              const serverRes = await this.client.get(`${this.baseUrl}/ajax/server/list?servers=${encodeURIComponent(epDataIds)}`, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
              });
              const serverHtml = typeof serverRes.data === 'string' ? serverRes.data : (serverRes.data?.result || '');
              const $$$ = load(serverHtml);
              
              const subSources: any[] = [];
              const subSubtitles: any[] = [];
              let subIntro: any = null;
              let subOutro: any = null;

              const dubSources: any[] = [];
              const dubSubtitles: any[] = [];
              let dubIntro: any = null;
              let dubOutro: any = null;

              const divs = $$$('.servers > div.type');
              for (const divEl of divs.toArray()) {
                const div = $$$ (divEl);
                const type = div.attr('data-type') || '';
                const lis = div.find('li[data-link-id]');
                
                for (const liElement of lis.toArray()) {
                  const li = $$$(liElement);
                  const embedLinkId = li.attr('data-link-id') || '';
                  const svId = li.attr('data-sv-id') || '';
                  const serverName = li.text().trim();

                  if (embedLinkId) {
                    try {
                      const svParam = svId ? `&sv=${svId}` : '';
                      const { data: rawEmbed } = await this.client.get(`${this.baseUrl}/ajax/server?get=${encodeURIComponent(embedLinkId)}${svParam}`, {
                        headers: { 'X-Requested-With': 'XMLHttpRequest' }
                      });
                      const resObj = typeof rawEmbed === 'string' ? JSON.parse(rawEmbed) : rawEmbed;
                      const tempEmbedUrl = resObj?.result?.url || resObj?.url || resObj?.link || '';

                      if (tempEmbedUrl) {
                        const finalUrl = tempEmbedUrl.startsWith('http') ? tempEmbedUrl : `https:${tempEmbedUrl}`;
                        const embedRes = await this.client.get(finalUrl, {
                          headers: {
                            Referer: `${this.baseUrl}/`,
                            Origin: this.baseUrl,
                            'User-Agent': USER_AGENT,
                          }
                        });
                        const embedHtml = typeof embedRes.data === 'string' ? embedRes.data : String(embedRes.data);
                        const dataId = embedHtml.match(/id="megaplay-player"\s*data-id="(\d+)"/)?.[1] || embedHtml.match(/data-id="(\d+)"/)?.[1] || embedHtml.match(/id="(\d+)"/)?.[1];

                        if (dataId) {
                          const embedDomain = new URL(finalUrl).hostname;
                          const apiRes = await this.client.get(`https://${embedDomain}/stream/getSources?id=${encodeURIComponent(dataId)}`, {
                            headers: {
                              Referer: finalUrl,
                              Origin: `https://${embedDomain}`,
                              'X-Requested-With': 'XMLHttpRequest',
                              'User-Agent': USER_AGENT,
                            }
                          });
                          const apiData = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data;
                          const finalStreamUrl = apiData?.sources?.file || apiData?.sources?.url || apiData?.source || apiData?.url || apiData?.file || '';

                          if (finalStreamUrl) {
                            const sourceObj = {
                              url: finalStreamUrl,
                              isM3U8: finalStreamUrl.includes('.m3u8'),
                              quality: 'auto',
                              server: serverName,
                              headers: {
                                Referer: finalUrl,
                                'User-Agent': USER_AGENT,
                              },
                              isDub: type === 'dub'
                            };
                            
                            const tracks: any[] = [];
                            if (apiData?.tracks && Array.isArray(apiData.tracks)) {
                              for (const track of apiData.tracks) {
                                if (track.file) {
                                  tracks.push({
                                    url: track.file,
                                    lang: track.label || 'English',
                                  });
                                }
                              }
                            }
                            
                            if (type === 'dub') {
                              if (!dubSources.some(s => s.url === finalStreamUrl)) {
                                dubSources.push(sourceObj);
                              }
                              for (const t of tracks) {
                                if (!dubSubtitles.some(s => s.url === t.url)) {
                                  dubSubtitles.push(t);
                                }
                              }
                              if (apiData?.intro) dubIntro = apiData.intro;
                              if (apiData?.outro) dubOutro = apiData.outro;
                            } else {
                              if (!subSources.some(s => s.url === finalStreamUrl)) {
                                subSources.push(sourceObj);
                              }
                              for (const t of tracks) {
                                if (!subSubtitles.some(s => s.url === t.url)) {
                                  subSubtitles.push(t);
                                }
                              }
                              if (apiData?.intro) subIntro = apiData.intro;
                              if (apiData?.outro) subOutro = apiData.outro;
                            }
                          }
                        }
                      }
                    } catch (err) {}
                  }
                }
              }

              const result: any = {
                headers: { Referer: this.baseUrl }
              };
              
              if (subSources.length > 0) {
                result.sub = {
                  sources: subSources,
                  subtitles: subSubtitles,
                  intro: subIntro,
                  outro: subOutro,
                  download: subSources[0].url,
                };
              }
              
              if (dubSources.length > 0) {
                result.dub = {
                  sources: dubSources,
                  subtitles: dubSubtitles,
                  intro: dubIntro,
                  outro: dubOutro,
                  download: dubSources[0].url,
                };
              }
              
              if (subSources.length > 0 || dubSources.length > 0) {
                return result;
              }
            }
          }
        }
      }

      if (!embedUrl && linkId) {
        try {
          const { data: raw } = await this.client.get(`${this.baseUrl}/ajax/server?get=${linkId}`, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });

          let resObj = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (typeof resObj.result === 'string') {
            try { resObj.result = JSON.parse(resObj.result); } catch (e) {}
          }
          embedUrl = resObj?.result?.url || resObj?.url || resObj?.link || '';
        } catch (err) {}
      }

      if (embedUrl) {
        if (!embedUrl.startsWith('http')) {
          embedUrl = `https:${embedUrl}`;
        }

        try {
          const embedRes = await this.client.get(embedUrl, {
            headers: {
              Referer: `${this.baseUrl}/`,
              Origin: this.baseUrl,
              'User-Agent': USER_AGENT,
            }
          });
          const embedHtml = typeof embedRes.data === 'string' ? embedRes.data : String(embedRes.data);
          const dataId = embedHtml.match(/id="megaplay-player"\s*data-id="(\d+)"/)?.[1] || embedHtml.match(/data-id="(\d+)"/)?.[1] || embedHtml.match(/id="(\d+)"/)?.[1];

          if (dataId) {
            const embedDomain = new URL(embedUrl).hostname;
            const apiRes = await this.client.get(`https://${embedDomain}/stream/getSources?id=${encodeURIComponent(dataId)}`, {
              headers: {
                Referer: embedUrl,
                Origin: `https://${embedDomain}`,
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': USER_AGENT,
              }
            });
            const apiData = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data;
            const finalStreamUrl = apiData?.sources?.file || apiData?.sources?.url || apiData?.source || apiData?.url || apiData?.file || '';

            if (finalStreamUrl) {
              return {
                headers: { Referer: embedUrl },
                sub: {
                  sources: [
                    {
                      url: finalStreamUrl,
                      isM3U8: finalStreamUrl.includes('.m3u8'),
                      quality: 'auto',
                      headers: {
                        Referer: embedUrl,
                        'User-Agent': USER_AGENT,
                      },
                      isDub: false
                    }
                  ],
                  download: embedUrl
                }
              };
            }
          }
        } catch (embedErr) {}

        let fallbackUrl = embedUrl;
        if (fallbackUrl.includes('=') || fallbackUrl.includes('&')) {
          if (episodeId.includes('$episode$')) {
            const parts = episodeId.split('$episode$');
            fallbackUrl = `${this.baseUrl}/watch/${parts[0]}/ep-${parts[1]}`;
          } else {
            fallbackUrl = `${this.baseUrl}/watch/${episodeId}`;
          }
        }

        return {
          headers: { Referer: this.baseUrl },
          sub: {
            sources: [
              {
                url: fallbackUrl,
                isM3U8: fallbackUrl.includes('.m3u8'),
                quality: 'auto',
                headers: {
                  Referer: this.baseUrl,
                  'User-Agent': USER_AGENT,
                },
                isDub: false
              }
            ],
            download: fallbackUrl
          }
        };
      }

      throw new Error('Stream URL not found');
    } catch (err) {
      throw err;
    }
  };

  private verifyLoginState = async (connectSid: string): Promise<boolean> => {
    try {
      const { data } = await this.client.get(`${this.baseUrl}/ajax/login-state`, {
        headers: {
          Cookie: `connect.sid=${connectSid}`,
        },
      });
      return data.is_login;
    } catch (err) {
      return false;
    }
  };

  private retrieveServerId = ($: any, index: number, subOrDub: SubOrSub) => {
    const rawOrSubOrDub = (raw: boolean) =>
      $(`.ps_-block.ps_-block-sub.servers-${raw ? 'raw' : subOrDub} > .ps__-list .server-item`)
        .map((i: any, el: any) => ($(el).attr('data-server-id') == `${index}` ? $(el) : null))
        .get()[0]
        .attr('data-id');
    try {
      // Attempt to get the subOrDub ID
      return rawOrSubOrDub(false);
    } catch (error) {
      // If an error is thrown, attempt to get the raw ID (The raw is the newest episode uploaded to hianime)
      return rawOrSubOrDub(true);
    }
  };

  /**
   * @param url string
   */
  private scrapeCardPage = async (url: string, headers?: object): Promise<ISearch<IAnimeResult>> => {
    try {
      const res: ISearch<IAnimeResult> = {
        currentPage: 0,
        hasNextPage: false,
        totalPages: 0,
        results: [],
      };

      const { data } = await this.client.get(url, headers);
      const $ = load(data);
      const pagination = $('ul.pagination, .pagination');
      res.results = await this.scrapeCard($);

      if (res.results.length > 0) {
        const currentPageText = pagination.find('.page-item.active, li.active')?.text()?.trim();
        res.currentPage = currentPageText ? parseInt(currentPageText) : 1;
        if (isNaN(res.currentPage) || res.currentPage === 0) {
          res.currentPage = 1;
        }

        const nextPage = pagination.find('a[title=Next], a.next, a[rel=next]')?.attr('href');
        if (nextPage != undefined && nextPage != '') {
          res.hasNextPage = true;
        }

        const totalPagesHref = pagination.find('a[title=Last], li:last-child a')?.attr('href');
        if (totalPagesHref) {
          const totalPagesStr = totalPagesHref.split('=').pop();
          res.totalPages = totalPagesStr ? parseInt(totalPagesStr) : res.currentPage;
          if (isNaN(res.totalPages)) {
            res.totalPages = res.currentPage;
          }
        } else {
          res.totalPages = res.currentPage;
        }
      } else {
        res.currentPage = 0;
        res.hasNextPage = false;
        res.totalPages = 0;
      }
      return res;
    } catch (err) {
      return {
        currentPage: 1,
        hasNextPage: false,
        totalPages: 0,
        results: [],
      };
    }
  };

  /**
   * @param $ cheerio instance
   */
  private scrapeCard = async ($: CheerioAPI): Promise<IAnimeResult[]> => {
    try {
      const results: IAnimeResult[] = [];

      $('.flw-item, #list-items > .item, .item').each((i: number, ele: any) => {
        try {
          const card = $(ele);
          const atag = card.find('.film-name a, a.name.d-title, .name a, .b1 a, a[href*="/watch/"]').first();

          const href = atag.attr('href');
          if (!href) {
            return;
          }

          let id = href.split('/watch/').pop()?.split('?')[0] || href.split('/')[1]?.split('?')[0];
          if (!id) {
            return;
          }
          if (id.includes('/ep-')) {
            id = id.split('/ep-')[0];
          }

          const title = card.find('.film-name a, a.name.d-title, .name a').first().text().trim() || card.find('img').attr('alt') || '';
          if (!title) return;

          const watchList = card.find('.dropdown-menu .added').text().trim() as WatchListType;
          const type = card
            .find('.meta .inner .right, .meta .m-item label, .fdi-item')
            ?.first()
            ?.text()
            .trim()
            .replace(' (? eps)', '')
            .replace(/\s\(\d+ eps\)/g, '');

          const image = card.find('img')?.attr('src') || card.find('img')?.attr('data-src');

          const sub = parseInt(card.find('.ep-status.sub span, .tick-item.tick-sub')?.first()?.text()?.replace(/\D+/g, '')) || 0;
          const dub = parseInt(card.find('.ep-status.dub span, .tick-item.tick-dub')?.first()?.text()?.replace(/\D+/g, '')) || 0;
          const episodes = parseInt(card.find('.ep-status.total span, .tick-item.tick-eps')?.first()?.text()?.replace(/\D+/g, '')) || 0;

          const cleanUrl = href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? href : '/' + href}`;

          results.push({
            id: id,
            title: title,
            url: cleanUrl,
            image: image,
            duration: card.find('.fdi-duration')?.text()?.trim(),
            watchList: watchList || WatchListType.NONE,
            japaneseTitle: atag.attr('data-jp') || atag.attr('data-jname'),
            type: type as MediaFormat,
            nsfw: card.find('.tick-rate')?.text() === '18+' ? true : false,
            sub: sub,
            dub: dub,
            episodes: episodes,
          });
        } catch (cardErr) {
          // Continue with next card instead of failing completely
        }
      });

      return results;
    } catch (err) {
      console.error('Hianime scrapeCard error:', (err as Error).message);
      throw new Error('Something went wrong. Please try again later.');
    }
  };
  /**
   * @deprecated
   * @param episodeId Episode id
   */
  override fetchEpisodeServers = (episodeId: string): Promise<IEpisodeServer[]> => {
    throw new Error('Method not implemented.');
  };
}

export default AniKoto;
