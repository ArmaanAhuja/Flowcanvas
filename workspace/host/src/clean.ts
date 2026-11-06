// What `pnpm workspace:clean` removes. Only Flowcanvas's own Docker objects: labelled as ours, or named
// `fc-test-*` (test leftovers). Anything else on the laptop is never touched (owner, 4 Nov 2026).
import { LABEL } from '@flowcanvas/workspace-image';
import type { Docker } from './docker-cli.js';

export type Kind = 'container' | 'network' | 'volume' | 'image';

export interface DockerObject {
  readonly kind: Kind;
  readonly name: string;
  /** The `org.flowcanvas.prefix` label, or '' without one. */
  readonly prefix: string;
  /** Whether it carries `org.flowcanvas.workspace=1`. */
  readonly ours: boolean;
}

export interface CleanOptions {
  /** Also every real workspace, with its files, and every workspace image. */
  readonly all: boolean;
  /** The image the current Dockerfile builds; kept unless `all`. */
  readonly currentImage: string;
}

const isTestLeftover = (object: DockerObject) =>
  object.name.startsWith('fc-test-') || object.prefix.startsWith('fc-test-');

/** The objects to remove, in a safe order: containers, then networks, volumes and images. */
export function planClean(objects: readonly DockerObject[], options: CleanOptions): DockerObject[] {
  const order: Kind[] = ['container', 'network', 'volume', 'image'];
  return objects
    .filter((object) => {
      if (object.kind === 'image') {
        if (!object.name.startsWith('flowcanvas-workspace:')) return false;
        return options.all || object.name !== options.currentImage;
      }
      if (isTestLeftover(object)) return true;
      return options.all && object.ours;
    })
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

async function list(docker: Docker, kind: Exclude<Kind, 'image'>): Promise<DockerObject[]> {
  const format = `{{${kind === 'container' ? '.Names' : '.Name'}}}\t{{.Label "${LABEL.prefix}"}}\t{{.Label "${LABEL.ours}"}}`;
  const command = kind === 'container' ? ['ps', '--all'] : [kind, 'ls'];
  const { stdout } = await docker([...command, '--format', format]);
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [name = '', prefix = '', ours = ''] = line.split('\t');
      return { kind, name, prefix, ours: ours === '1' };
    });
}

export async function findObjects(docker: Docker): Promise<DockerObject[]> {
  const images = (
    await docker([
      'image',
      'ls',
      '--filter',
      'reference=flowcanvas-workspace',
      '--format',
      '{{.Repository}}:{{.Tag}}',
    ])
  ).stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((name): DockerObject => ({ kind: 'image', name, prefix: '', ours: true }));
  return [
    ...(await list(docker, 'container')),
    ...(await list(docker, 'network')),
    ...(await list(docker, 'volume')),
    ...images,
  ];
}

export async function remove(docker: Docker, object: DockerObject): Promise<void> {
  const command = {
    container: ['rm', '--force', '--volumes'],
    network: ['network', 'rm'],
    volume: ['volume', 'rm', '--force'],
    image: ['image', 'rm'],
  }[object.kind];
  await docker([...command, object.name]);
}
