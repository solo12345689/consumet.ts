import { ANIME, MANGA, BOOKS, COMICS, LIGHT_NOVELS, MOVIES, META, NEWS } from '../providers';

// List of providers
export const PROVIDERS_LIST = {
  ANIME: [
    new ANIME.AniKoto(),
    new ANIME.ReAnime(),
    new ANIME.AnimeWorld(),
    new ANIME.GogoAnime(),
    new ANIME.AnimeSaturn(),
    new ANIME.Miruro(),
  ],
  MANGA: [
    new MANGA.WeebCentral(),
    new MANGA.MangaHere(),
    new MANGA.MangaPill(),
    new MANGA.MangaDex(),
    new MANGA.MangaKakalot(),
    new MANGA.ComicK(),
  ],
  BOOKS: [],
  COMICS: [new COMICS.GetComics()],
  LIGHT_NOVELS: [],
  MOVIES: [
    new MOVIES.FlixHQ(),
    new MOVIES.Goku(),
    new MOVIES.SFlix(),
    new MOVIES.HiMovies(),
    new MOVIES.Turkish(),
  ],
  NEWS: [new NEWS.ANN()],
  META: [new META.Anilist(), new META.TMDB(), new META.Myanimelist()],
  OTHERS: [],
};
