export type AppVersionInfo = {
  label: string;
  version: string;
  sha: string;
  shortSha: string;
  ref: string;
  refType: 'tag' | 'branch' | string;
  builtAt: string;
};
