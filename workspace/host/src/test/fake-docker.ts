// A small in-memory Docker that understands the commands WorkspaceHost runs, for unit tests.
import { DockerFailure, type Docker } from '../docker-cli.js';

type Status = 'running' | 'paused' | 'exited';

interface Container {
  status: Status;
  labels: Map<string, string>;
  networks: Set<string>;
  files: Set<string>;
}

export class FakeDocker {
  readonly calls: string[][] = [];
  readonly containers = new Map<string, Container>();
  readonly networks = new Map<string, Map<string, string>>();
  readonly volumes = new Set<string>();
  /** Makes the next `git clone` fail with this exit code. */
  failClone: number | undefined;
  /** Called before each command, to hold or observe it. */
  before: ((args: readonly string[]) => Promise<void>) | undefined;

  readonly run: Docker = async (args) => {
    this.calls.push([...args]);
    if (this.before !== undefined) await this.before(args);
    return { stdout: this.#answer(args) };
  };

  /** The commands run, each as one line, without the many flags of `run`. */
  get commands(): string[] {
    return this.calls.map((args) =>
      args[0] === 'run' ? `run ${String(args[args.indexOf('--name') + 1])}` : args.join(' '),
    );
  }

  #missing(name: string): never {
    throw new DockerFailure(1, `Error response from daemon: No such object: ${name}`);
  }

  #container(name: string): Container {
    return this.containers.get(name) ?? this.#missing(name);
  }

  #answer(args: readonly string[]): string {
    const [command, ...rest] = args;
    const last = rest.at(-1) ?? '';
    switch (command) {
      case 'inspect': {
        const container = this.#container(last);
        const format = rest[rest.indexOf('--format') + 1] ?? '';
        if (format.includes('egress-version')) {
          return `${container.labels.get('org.flowcanvas.egress-version') ?? ''} ${container.status}`;
        }
        return container.status;
      }
      case 'network':
      case 'volume':
        return this.#object(command, rest);
      case 'run': {
        const name = rest[rest.indexOf('--name') + 1] ?? '';
        const labels = new Map<string, string>();
        const networks = new Set<string>();
        rest.forEach((arg, i) => {
          const value = rest[i + 1] ?? '';
          if (arg === '--label') {
            const [key = '', label = ''] = value.split('=');
            labels.set(key, label);
          }
          if (arg === '--network') networks.add(value);
        });
        this.containers.set(name, { status: 'running', labels, networks, files: new Set() });
        return name;
      }
      case 'ps': {
        const wanted = rest
          .filter((_, i) => rest[i - 1] === '--filter')
          .map((filter) => filter.replace(/^label=/, ''));
        return [...this.containers.entries()]
          .filter(([, c]) =>
            wanted.every((filter) => {
              if (filter.startsWith('status=')) return c.status === filter.slice(7);
              const [key = '', value = ''] = filter.split('=');
              return c.labels.get(key) === value;
            }),
          )
          .map(([name]) => name)
          .join('\n');
      }
      case 'pause':
        this.#container(last).status = 'paused';
        return '';
      case 'unpause':
      case 'start':
        this.#container(last).status = 'running';
        return '';
      case 'stop':
        this.#container(last).status = 'exited';
        return '';
      case 'rm':
        this.containers.delete(last);
        return '';
      case 'exec':
        return this.#exec(rest);
      default:
        throw new Error(`FakeDocker doesn't know: ${args.join(' ')}`);
    }
  }

  #object(type: 'network' | 'volume', rest: readonly string[]): string {
    const [verb] = rest;
    const name = rest.at(-1) ?? '';
    const exists = type === 'network' ? this.networks.has(name) : this.volumes.has(name);
    if (verb === 'inspect') return exists ? name : this.#missing(name);
    if (verb === 'create') {
      if (type === 'network') this.networks.set(name, new Map());
      else this.volumes.add(name);
      return name;
    }
    if (verb === 'connect') {
      const [, network = '', container = ''] = rest;
      const target = this.#container(container);
      if (target.networks.has(network)) {
        throw new DockerFailure(1, 'endpoint with name already exists in network');
      }
      target.networks.add(network);
      return '';
    }
    if (verb === 'ls') {
      return [...this.networks.keys()].filter((n) => n.includes('-ws-')).join('\n');
    }
    throw new Error(`FakeDocker doesn't know: ${type} ${rest.join(' ')}`);
  }

  #exec(rest: readonly string[]): string {
    const [name = '', program, ...argv] = rest;
    const container = this.#container(name);
    if (container.status !== 'running')
      throw new DockerFailure(1, `container ${name} is not running`);
    if (program === 'test') {
      const path = argv.at(-1) ?? '';
      // `test -d dir` is true when anything lives under it.
      const found =
        container.files.has(path) ||
        [...container.files].some((file) => file.startsWith(`${path}/`));
      if (!found) throw new DockerFailure(1, '');
      return '';
    }
    if (program === 'git') {
      if (this.failClone !== undefined) {
        const code = this.failClone;
        this.failClone = undefined;
        throw new DockerFailure(code, 'fatal: could not read from https://github.com/x/private');
      }
      container.files.add(`${argv.at(-1) ?? ''}/.git`);
      return '';
    }
    if (program === 'rm') {
      container.files.clear();
      return '';
    }
    throw new Error(`FakeDocker exec doesn't know: ${String(program)}`);
  }
}
