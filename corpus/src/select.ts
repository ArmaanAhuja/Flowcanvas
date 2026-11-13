// Which corpus projects one run of the Docker corpus test opens (owner, 13 Nov 2026: CI splits the 9-minute job into
// parallel shards). CORPUS_ONLY names projects; CORPUS_EXCEPT names the ones another shard takes. The shard with
// CORPUS_EXCEPT takes everything else, so a project added to the manifest is always tested somewhere. Neither set:
// all of them, as on a laptop.

/** The projects to open, in manifest order; throws on a mistake rather than quietly testing less. */
export function selectRepos<T extends { readonly id: string }>(
  repos: readonly T[],
  env: { readonly only?: string | undefined; readonly except?: string | undefined },
): T[] {
  const list = (value: string | undefined) =>
    (value ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
  const only = list(env.only);
  const except = list(env.except);
  if (only.length > 0 && except.length > 0) {
    throw new Error('Set CORPUS_ONLY or CORPUS_EXCEPT, not both.');
  }
  const known = new Set(repos.map((repo) => repo.id));
  const unknown = [...only, ...except].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Not in corpus/manifest.json: ${unknown.join(', ')}.`);
  }
  const chosen = repos.filter((repo) =>
    only.length > 0 ? only.includes(repo.id) : !except.includes(repo.id),
  );
  if (chosen.length === 0) throw new Error('This selection opens no corpus project.');
  return chosen;
}
