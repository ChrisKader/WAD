// Courtesy of JohnstonCode https://github.com/JohnstonCode/scm-scm/blob/master/src/scmFinder.ts

import * as cp from 'child_process';
import * as semver from 'semver';
import * as iconv from 'iconv-lite-umd';
import * as proc from 'process';
import { Readable } from 'stream';
import { CancellationToken, Progress, ProgressLocation, ProgressOptions, Uri, window, workspace as Workspace,FileSystemError, Disposable } from 'vscode';
import { assign, dispose, IDisposable, log, onceEvent, toDisposable } from './msutil';
import { basename as Basename, dirname as Dirname, join as Join } from 'path';
import { StringDecoder } from 'string_decoder';
import * as byline from 'byline';

export type TValidScm = 'git' | 'svn';

interface ISuppScm {
  bin: string;
  check: string[];
  folder: string;
  minVer: string;
  name: string;
  scm: TValidScm;
  args: string[];
}

type TScmInfo = {
  scm: string;
  path: string;
  version: string;
  found: boolean;
};

type TSuppScmInfo = ISuppScm & TScmInfo;

interface IExecutionResult<T extends string | Buffer> {
	exitCode: number;
	stdout: T;
	stderr: string;
}

interface SpawnOptions extends cp.SpawnOptions {
	input?: string;
	encoding?: string;
	log?: boolean;
	cancellationToken?: CancellationToken;
	onSpawn?: (childProcess: cp.ChildProcess) => void;
}
export interface BufferResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

interface ICheckoutOptions {
  scmInfo: TSuppScmInfo,
  targetUri: Uri
  readonly progress: Progress<{ increment: number }>;
}
type CheckoutReturn = {
  checkoutDir:Uri,
  options:ICheckoutOptions
}
type TScm = {
  checkout(repoUrl: string, targetUri: Uri): Promise<CheckoutReturn>;
} & TSuppScmInfo;

export type ScmType = {
  [V in TValidScm as string]: TScm
};

const enum ScmErrorCodes {
  E170001 = 'FailedAuth',
  AuthenticationFailed = 'FailedAuth',
  E155004 = 'RepoLocked',
  RepositoryIsLocked = 'RepoLocked',
  E155007 = 'NotASvnRepository',
  NotAGitRepository = 'NotAGitRepository',
  NotARepo = 'NotARepo',
  E170013 = 'UnableToConnect',
  CantAccessRemote = 'UnableToConnect',
}

const svnErrorCodes: { [key: string]: string } = {
  AuthorizationFailed: 'E170001',
  RepositoryIsLocked: 'E155004',
  NotASvnRepository: 'E155007',
  NotShareCommonAncestry: 'E195012',
  WorkingCopyIsTooOld: 'E155036'
};

const enum GitErrorCodes {
	BadConfigFile = 'BadConfigFile',
	AuthenticationFailed = 'AuthenticationFailed',
	NoUserNameConfigured = 'NoUserNameConfigured',
	NoUserEmailConfigured = 'NoUserEmailConfigured',
	NoRemoteRepositorySpecified = 'NoRemoteRepositorySpecified',
	NotAGitRepository = 'NotAGitRepository',
	NotAtRepositoryRoot = 'NotAtRepositoryRoot',
	Conflict = 'Conflict',
	StashConflict = 'StashConflict',
	UnmergedChanges = 'UnmergedChanges',
	PushRejected = 'PushRejected',
	RemoteConnectionError = 'RemoteConnectionError',
	DirtyWorkTree = 'DirtyWorkTree',
	CantOpenResource = 'CantOpenResource',
	GitNotFound = 'GitNotFound',
	CantCreatePipe = 'CantCreatePipe',
	PermissionDenied = 'PermissionDenied',
	CantAccessRemote = 'CantAccessRemote',
	RepositoryNotFound = 'RepositoryNotFound',
	RepositoryIsLocked = 'RepositoryIsLocked',
	BranchNotFullyMerged = 'BranchNotFullyMerged',
	NoRemoteReference = 'NoRemoteReference',
	InvalidBranchName = 'InvalidBranchName',
	BranchAlreadyExists = 'BranchAlreadyExists',
	NoLocalChanges = 'NoLocalChanges',
	NoStashFound = 'NoStashFound',
	LocalChangesOverwritten = 'LocalChangesOverwritten',
	NoUpstreamBranch = 'NoUpstreamBranch',
	IsInSubmodule = 'IsInSubmodule',
	WrongCase = 'WrongCase',
	CantLockRef = 'CantLockRef',
	CantRebaseMultipleBranches = 'CantRebaseMultipleBranches',
	PatchDoesNotApply = 'PatchDoesNotApply',
	NoPathFound = 'NoPathFound',
	UnknownPath = 'UnknownPath',
}

export interface IScmErrorData {
  scm: TSuppScmInfo,
	error?: Error;
	message?: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	errorCode?: string;
	command?: string;
	args?: string[];
}
export class ScmError {
  scm: TSuppScmInfo;
  error?: Error;
	message: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	errorCode?: string;
	command?: string;
  args?: string[];

  constructor(data: IScmErrorData) {
		if (data.error) {
			this.error = data.error;
			this.message = data.error.message;
		} else {
			this.error = undefined;
			this.message = '';
		}
    this.scm = data.scm;
		this.message = this.message || data.message || 'Scm error';
		this.stdout = data.stdout;
		this.stderr = data.stderr;
		this.exitCode = data.exitCode;
		this.errorCode = data.errorCode;
		this.command = data.command;
		this.args = data.args;
	}

	toString(): string {
		let result = this.message + ' ' + JSON.stringify({
			exitCode: this.exitCode,
			scmErrorCode: this.errorCode,
			scmCommand: this.command,
			stdout: this.stdout,
			stderr: this.stderr
		}, null, 2);

		if (this.error) {
			result += (<any>this.error).stack;
		}

		return result;
	}
}

// https://github.com/microsoft/vscode/issues/89373
// https://github.com/git-for-windows/git/issues/2478
function sanitizePath(path: string): string {
	return path.replace(/^([a-z]):\\/i, (_, letter) => `${letter.toUpperCase()}:\\`);
}

export class Scm {
  public readonly supported: ISuppScm[] = [
    {
      bin: 'git',
      check: ['version'],
      folder: 'Git',
      minVer: '0.0.0',
      name: 'Git',
      scm: 'git',
      args: ['clone', '$repoUrl$', '$repoPath$'],
    },
    {
      bin: 'svn',
      check: ['--version', '--quiet'],
      folder: 'TortoiseSVN',
      minVer: '1.6.0',
      name: 'Svn',
      scm: 'svn',
      args: ['checkout', '$repoUrl$', '$repoPath$', '--non-interactive']
    }
  ];
  disposables:Disposable[] = []
  private _foundScms = new Map<TValidScm, TSuppScmInfo>();

  async initialScan(){
    return new Promise<boolean>((res,rej)=>{
      res(this.supported.every(async scm =>{
        return await this._find(scm.scm).then(async (v)=>{
          return true;
        },(r)=>{
          return true;
        }).catch((r)=>{
          return true;
        });
      }));
    });
  }
  async _initialize() {
    return await this.initialScan();
  }

  constructor() {

  }

  public get = async (scm: TValidScm): Promise<TScm> => {
    return new Promise((resolve, reject) => this._ready(scm, true).then(scmInfo => {
      if (scmInfo) {
        resolve({
          ...scmInfo,
          checkout: async (url: string, targetUri: Uri) => {
            const opt: ProgressOptions = {
              location: ProgressLocation.Notification,
              title: `Instaling requested library '${url}'...`,
              cancellable: true,
            };

            return await window.withProgress(opt,
              (progress, token) => this._checkout(url, { scmInfo, progress, targetUri }, token)
            );
          }
        });
      }
      reject(`${scm} not ready`);
    },(r)=>{
      return reject(false);
    }));
  };

  private _ready = async (scm: TValidScm, start?: boolean): Promise<TSuppScmInfo> => {
    const rtnScm = this._foundScms.get(scm);
    if (rtnScm && await this._checkScm(rtnScm)) {
      return rtnScm;
    }
    if(start){
      return this._find(scm);
    }
    return Promise.reject(false);
  };

  private _checkScm = (scm: TSuppScmInfo): Promise<boolean> => {
    return new Promise<boolean>((c, e) => {
      const buffers: Buffer[] = [];
      const child = cp.spawn(scm.path, scm.check);
      (child.stdout as Readable).on('data', (b: Buffer) => buffers.push(b));
      child.on('error', (e => {
        log('ERROR', '_checkScm',e);
      }));
      child.on('close', code =>
        code
          ? e(false)
          : c(true)
      );
    });
  };

  private _checkout = async (url: string, options: ICheckoutOptions, cancellationToken?: CancellationToken):Promise<CheckoutReturn> => {
    let folderName = Basename(options.targetUri.fsPath);
    let parentDir = options.targetUri.fsPath.replace(folderName,'.clone');

    let checkoutDir = Join(parentDir, folderName);
    await Workspace.fs.delete(Uri.file(parentDir),{recursive: true, useTrash: false}).then(void 0,(r:FileSystemError)=>{
      log('ERROR','_checkout',r);
    });

    await Workspace.fs.createDirectory(Uri.file(parentDir));

    const args = options.scmInfo.args.map(v => v === '$repoUrl$' ? url : v === '$repoPath$' ? checkoutDir : v);

    const onSpawn = (child: cp.ChildProcess) => {
      const decoder = new StringDecoder('utf8');

      const lineStream = new byline.LineStream({ encoding: 'utf8' });
      child.stderr!.on('data', (buffer: Buffer) => child.stdin!.write(decoder.write(buffer)));

      let totalProgress = 0;
      let previousProgress = 0;

      lineStream.on('data', (line: string) => {
        let match: RegExpMatchArray | null = null;
        log('OnSpawn',line);
        if (match = /Counting objects:\s*(\d+)%/i.exec(line)) {
          totalProgress = Math.floor(parseInt(match[1]) * 0.1);
        } else if (match = /Compressing objects:\s*(\d+)%/i.exec(line)) {
          totalProgress = 10 + Math.floor(parseInt(match[1]) * 0.1);
        } else if (match = /Receiving objects:\s*(\d+)%/i.exec(line)) {
          totalProgress = 20 + Math.floor(parseInt(match[1]) * 0.4);
        } else if (match = /Resolving deltas:\s*(\d+)%/i.exec(line)) {
          totalProgress = 60 + Math.floor(parseInt(match[1]) * 0.4);
        }

        if (totalProgress !== previousProgress) {
          options.progress.report({ increment: totalProgress - previousProgress });
          previousProgress = totalProgress;
        }
      });
    };

    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const spawnOptions: SpawnOptions = {
          onSpawn,
        };
        await this.exec(options.scmInfo, parentDir, args, spawnOptions);
        break;
      } catch (err: any) {
        if (
          attempt <= 3
        ) {
          continue;
        }
        throw err;
      }
    }
    return {
      checkoutDir: Uri.file(checkoutDir),
      options
    };
  };

  private exec = async (scm: TSuppScmInfo, cwd: string, args: string[], options: SpawnOptions = {}):Promise<IExecutionResult<string>> => {
    options = assign({ cwd }, options || {});
		return await this._exec(scm, args, options);
  };

  private _spawn = (scm: TSuppScmInfo,args: string[], options: SpawnOptions = {}): cp.ChildProcess => {
		if (!options) {
			options = {};
		}

		if (!options.stdio && !options.input) {
			options.stdio = ['ignore', null, null]; // Unless provided, ignore stdin and leave default streams for stdout and stderr
		}

		options.env = Object.assign({}, proc.env, options.env || {}, {
			LC_ALL: 'en_US.UTF-8',
			LANG: 'en_US.UTF-8',
		});

		if (options.cwd) {
			options.cwd = sanitizePath(options.cwd);
		}

		return cp.spawn(scm.path, args, options);
	};

  private _exec = async (scm:TSuppScmInfo, args: string[], options: SpawnOptions = {}): Promise<IExecutionResult<string>> => {
    const child = this._spawn(scm,args, options);
    const disposables: IDisposable[] = [];
    if (options.onSpawn) {
			options.onSpawn(child);
		}

		if (options.input) {
			child.stdin!.end(options.input, 'utf8');
		}

		const startTime = Date.now();
		const bufferResult = await exec(scm,child, options.cancellationToken);

		if (options.log !== false) {
		log('_exec',`> ${scm.scm} ${args.join(' ')} [${Date.now() - startTime}ms]\n`);

			if (bufferResult.stderr.length > 0) {
				log('_exec',`${bufferResult.stderr}\n`);
			}
		}

		let encoding = options.encoding || 'utf8';
		encoding = iconv.encodingExists(encoding) ? encoding : 'utf8';

		const result: IExecutionResult<string> = {
			exitCode: bufferResult.exitCode,
			stdout: iconv.decode(bufferResult.stdout, encoding),
			stderr: bufferResult.stderr
		};

		if (bufferResult.exitCode) {
			return Promise.reject<IExecutionResult<string>>(new ScmError({
        scm,
				message: `Failed to execute ${scm.path}`,
				stdout: result.stdout,
				stderr: result.stderr,
				exitCode: result.exitCode,
				errorCode: getScmErrorCode(scm,result.stderr),
				command: args[0],
				args: args
			}));
		}

		return result;
  };

  private _parseVersion = (scmInfo: ISuppScm, raw: string): string => {
    if (scmInfo.scm === 'svn') { return raw; }

    return raw.replace(/^git version /, '');
  };

  private _path = (scm: ISuppScm, os: string, base?: string): string => {
    if (os === 'win32') {
      return Join(base ? base : '', scm.folder, 'bin', `${scm.bin}.exe`);
    }
    return 'Only win32 implented currently.';
  };

  private _checkScmVersion = (scm: TSuppScmInfo): Promise<TSuppScmInfo> => {
    return new Promise<TSuppScmInfo>((c, e) => {
      // fix compatibility with SlickSVN (like 1.6.17-SlikScm-tag-1.6.17@1130898-X64)
      const version = this._parseVersion(scm, scm.version).replace(/(\d+\.\d+\.\d+).*/, '$1');
      if (!semver.valid(version)) {
        e(new Error(`Invalid ${scm} version`));
      } else if (!semver.gte(version, scm.minVer)) {
        e(new Error(`Required ${scm} version must be >= 1.6`));
      } else {
        this._foundScms.set(scm.scm, scm);
        c(scm);
      }
    });
  };

  private _findSystemScmWin32 = (scm: ISuppScm, base?: string): Promise<TSuppScmInfo> => {
    if (!base) {
      return Promise.reject<TSuppScmInfo>('Not found');
    }

    return this._findSpecificScm(scm, this._path(scm, 'win32', base));
  };

  private _findScmWin32 = (scm: ISuppScm): Promise<TSuppScmInfo> => {
    return this._findSystemScmWin32(scm, process.env.ProgramW6432)
      .then(void 0, () =>
        this._findSystemScmWin32(scm, process.env['ProgramFiles(x86)'])
      )
      .then(void 0, () => this._findSystemScmWin32(scm, process.env.ProgramFiles))
      .then(void 0, () => this._findSpecificScm(scm, scm.bin));
  };

  private _findScmDarwin = (scm: ISuppScm): Promise<TSuppScmInfo> => {
    return new Promise<TSuppScmInfo>((c, e) => {
      cp.exec(`which ${scm}`, (err, scmPathBuffer) => {
        if (err) {
          return e(`${scm} not found`);
        }
        const path = scmPathBuffer.toString().replace(/^\s+|\s+$/g, '');

        function getVersion(path: string) {
          // make sure scm executes

          cp.exec(scm.check.join(' '), (err, stdout) => {
            if (err) {
              return e(`${scm} not found`);
            }

            return c({ ...scm, path, version: stdout.trim(), found: true });
          });
        }

        if (path !== `/usr/bin/${scm}`) {
          return getVersion(path);
        }

        // must check if XCode is installed
        cp.exec('xcode-select -p', (err: any) => {
          if (err && err.code === 2) {
            // scm is not installed, and launching /usr/bin/scm
            // will prompt the user to install it

            return e(`${scm} not found`);
          }

          getVersion(path);
        });
      });
    });
  };

  private _findSpecificScm = (scm: ISuppScm, path: string): Promise<TSuppScmInfo> => {
    return new Promise<TSuppScmInfo>((c, e) => {
      const buffers: Buffer[] = [];
      const child = cp.spawn(path, scm.check);
      (child.stdout as Readable).on('data', (b: Buffer) => buffers.push(b));
      child.on('error', (e => {
        log('ERROR', '_findSpecificScm',e);
      }));
      child.on('close', code => {
        if (code) { e(new Error('Not found')); }
        c({
          ...scm,
          ...{
            path,
            found: true,
            version: this._parseVersion(scm, Buffer.concat(buffers).toString('utf8').trim())
          }
        });
      });
    });
  };

  private _find = (fScm: TValidScm, hint?: string): Promise<TSuppScmInfo> => {
    const scm = this.supported.find(s=>s.scm === fScm);
    if(!scm){
      return Promise.reject(new Error(`${scm} installation not found.`));
    }
    const first = hint
      ? this._findSpecificScm(scm, hint)
      : Promise.reject<TSuppScmInfo>(null);

    return first
      .then(void 0, () => {
        switch (process.platform) {
          case 'darwin':
            return this._findScmDarwin(scm);
          case 'win32':
            return this._findScmWin32(scm);
          default:
            return this._findSpecificScm(scm, scm.bin);
        }
      })
      .then(s => this._checkScmVersion(s))
      .then(null, () =>
        Promise.reject(new Error(`${scm} installation not found.`))
      );
  };

  dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}

async function exec(scm: TSuppScmInfo,child: cp.ChildProcess, cancellationToken?: CancellationToken): Promise<IExecutionResult<Buffer>> {
	if (!child.stdout || !child.stderr) {
		throw new ScmError({ scm, message: `Failed to get stdout or stderr from ${scm.scm} process.` });
	}

	if (cancellationToken && cancellationToken.isCancellationRequested) {
		throw new ScmError({ scm, message: 'Cancelled by VSCode' });
	}

	const disposables: IDisposable[] = [];

	const once = (ee: NodeJS.EventEmitter, name: string, fn: (...args: any[]) => void) => {
		ee.once(name, fn);
		disposables.push(toDisposable(() => ee.removeListener(name, fn)));
	};

	const on = (ee: NodeJS.EventEmitter, name: string, fn: (...args: any[]) => void) => {
		ee.on(name, fn);
		disposables.push(toDisposable(() => ee.removeListener(name, fn)));
	};

	let result = Promise.all<any>([
		new Promise<number>((c, e) => {
			once(child, 'error', cpErrorHandler(scm,e));
			once(child, 'exit', c);
		}),
		new Promise<Buffer>(c => {
			const buffers: Buffer[] = [];
			on(child.stdout!, 'data', (b: Buffer) => buffers.push(b));
			once(child.stdout!, 'close', () => c(Buffer.concat(buffers)));
		}),
		new Promise<string>(c => {
			const buffers: Buffer[] = [];
			on(child.stderr!, 'data', (b: Buffer) => buffers.push(b));
			once(child.stderr!, 'close', () => c(Buffer.concat(buffers).toString('utf8')));
		})
	]) as Promise<[number, Buffer, string]>;

	if (cancellationToken) {
		const cancellationPromise = new Promise<[number, Buffer, string]>((_, e) => {
			onceEvent(cancellationToken.onCancellationRequested)(() => {
				try {
					child.kill();
				} catch (err) {
					// noop
				}

				e(new ScmError({scm, message: 'Cancelled' }));
			});
		});
		result = Promise.race([result, cancellationPromise]);
	}

	try {
		const [exitCode, stdout, stderr] = await result;
		return { exitCode, stdout, stderr };
	} finally {
		dispose(disposables);
	}
}

function cpErrorHandler(scm:TSuppScmInfo,cb: (reason?: any) => void): (reason?: any) => void {
	return err => {
		if (/ENOENT/.test(err.message)) {
			err = new ScmError({
        scm,
				error: err,
				message: `Failed to execute ${scm} (ENOENT)`,
				errorCode: ScmErrorCodes.NotARepo
			});
		}

		cb(err);
	};
}

function getScmErrorCode(scm:TSuppScmInfo, stderr: string): string | undefined {
  if(scm.scm === 'svn'){
    for (const name in svnErrorCodes) {
      if (svnErrorCodes.hasOwnProperty(name)) {
        const code = svnErrorCodes[name];
        const regex = new RegExp(`svn: ${code}`);
        if (regex.test(stderr)) {
          return code;
        }
      }
    }

    if (/No more credentials or we tried too many times/.test(stderr)) {
      return svnErrorCodes.AuthorizationFailed;
    }
  }

  if(scm.scm === 'git'){
    if (/Another git process seems to be running in this repository|If no other git process is currently running/.test(stderr)) {
      return GitErrorCodes.RepositoryIsLocked;
    } else if (/Authentication failed/i.test(stderr)) {
      return GitErrorCodes.AuthenticationFailed;
    } else if (/Not a git repository/i.test(stderr)) {
      return GitErrorCodes.NotAGitRepository;
    } else if (/bad config file/.test(stderr)) {
      return GitErrorCodes.BadConfigFile;
    } else if (/cannot make pipe for command substitution|cannot create standard input pipe/.test(stderr)) {
      return GitErrorCodes.CantCreatePipe;
    } else if (/Repository not found/.test(stderr)) {
      return GitErrorCodes.RepositoryNotFound;
    } else if (/unable to access/.test(stderr)) {
      return GitErrorCodes.CantAccessRemote;
    } else if (/branch '.+' is not fully merged/.test(stderr)) {
      return GitErrorCodes.BranchNotFullyMerged;
    } else if (/Couldn\'t find remote ref/.test(stderr)) {
      return GitErrorCodes.NoRemoteReference;
    } else if (/A branch named '.+' already exists/.test(stderr)) {
      return GitErrorCodes.BranchAlreadyExists;
    } else if (/'.+' is not a valid branch name/.test(stderr)) {
      return GitErrorCodes.InvalidBranchName;
    } else if (/Please,? commit your changes or stash them/.test(stderr)) {
      return GitErrorCodes.DirtyWorkTree;
    }
  }
	return undefined;
}