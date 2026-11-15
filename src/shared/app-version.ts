export type AppReleaseNotes = {
  version: string;
  notes: string;
  url: string | null;
  publishedAt: string | null;
  updatedAt?: string;
};

export type AppVersionInfo = {
  label: string;
  version: string;
  sha: string;
  shortSha: string;
  ref: string;
  refType: 'tag' | 'branch' | string;
  builtAt: string;
  release?: AppReleaseNotes | null;
};
