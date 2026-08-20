declare module 'duckduckgo-search' {
  interface SearchResult {
    title: string;
    href: string;
    body: string;
  }

  const ddg: {
    text(
      keywords: string,
      region?: string,
      safesearch?: string,
      timelimit?: string | null
    ): AsyncGenerator<SearchResult, void, unknown>;
    
    images(
      keywords: string,
      region?: string,
      safesearch?: string,
      timelimit?: string | null,
      size?: string | null,
      color?: string | null,
      type_image?: string | null,
      layout?: string | null,
      license_image?: string | null
    ): AsyncGenerator<any, void, unknown>;
  };

  export default ddg;
}
