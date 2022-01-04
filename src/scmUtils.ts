import { extensions as Extensions, FileType, Uri, workspace as Workspace } from "vscode";
import * as cp from 'child_process';
import which from 'which';
import { Git, GitErrorCodes, GitExtension } from "./git";
import path, { join as Join } from 'path';
import { workspaceRecursiveCopy } from './util';
import { log } from "./msutil";

interface SvnCheckoutOptions {
  url: string;
  type: string;
  cloneDir: Uri;
  baseDir: Uri;
  destDir: string;
  revision?: string;
  tag?: string;
  args?: string[];
}

export interface IGit {
	path: string;
	version: string;
}

export class ScmUtils {
  private git?: Git["model"]["git"];

  constructor() {
    const gitExtension = Extensions.getExtension<GitExtension>('vscode.git')?.exports;
    this.git = gitExtension?.getAPI(1).git._model.git;
  }

  async gitSvnClone(options: SvnCheckoutOptions) {
    log(`gitSvnClone started for ${options.url}`);
    //gitExtension?.model.git.exec('C:\\dev\\',['svn','clone','-r','HEAD','https://repos.curseforge.com/wow/ace3/trunk/AceComm-3.0','test']);
    let defaultArgs = ['clone'];
    let defaultRev = ['-r', 'HEAD'];

    let execArgs = options.type === 'svn' ? ['svn',...defaultArgs] : defaultArgs;
    const cwd = options.baseDir.fsPath;

    if (options.args) {
      execArgs = execArgs.concat(options.args);
    }

    if(options.type === 'svn'){
      if (options.revision) {
        execArgs.push('-r', options.revision);
      } else {
        execArgs = execArgs.concat(defaultRev);
      }
    }

    const destDirUri = Uri.joinPath(options.baseDir,'/',options.destDir);
    const checkoutDir = Join(options.cloneDir.fsPath,'/',options.destDir.split('/').pop()!);
    const checkoutDirUri = Uri.joinPath(options.cloneDir, '/', options.destDir.split('/').pop()!);

    log(`Creating ${destDirUri.fsPath}`);
    const createDestDir = await Workspace.fs.createDirectory(checkoutDirUri).then(()=>{},(r)=>{
      log('ERROR',`Failed to create destDir ${destDirUri.fsPath}`);
    });

    execArgs.push(options.url, checkoutDir);

    log(`Executing clone command for ${options.url}`);
    return await this.git?.exec(cwd, execArgs).then(async checkoutResult=>{
      if(checkoutResult.exitCode === 0){
        const gitDir = Uri.joinPath(checkoutDirUri,'/',`.git`);
        log(`Deleting git dir ${gitDir.fsPath}.`);
        await Workspace.fs.delete(gitDir,{recursive: true,useTrash: false}).then(()=>{},(r)=>{
          log('ERROR',`Failed to delete ${Uri.joinPath(checkoutDirUri,`/.${options.type}`).fsPath}`,r);
        });
        log(`Starting copy of ${options.url} to ${destDirUri.fsPath}.`);
        await Workspace.fs.copy(checkoutDirUri,destDirUri,{overwrite: true});
        log(`SUCCESS! ${options.url} to ${destDirUri.fsPath}.`,checkoutResult);
        return {url:options.url,status:true};
        //return await workspaceRecursiveCopy(checkoutDirUri,destDirUri,['.git']);
      } else {
        log('ERROR',`Clone of ${options.url} failed. Deleting ${destDirUri.fsPath}`,execArgs,checkoutResult);
        await Workspace.fs.delete(destDirUri,{recursive:true,useTrash: false}).then(()=>{},(r)=>{
          log('ERROR',`Failed to delete ${destDirUri.fsPath}`,r);
        });
        return {url:options.url,status:false};
      }
    }).catch(async (r)=>{
      log('ERROR',`Clone of ${options.url} failed. Deleting ${destDirUri.fsPath}`,r);
      await Workspace.fs.delete(destDirUri,{recursive:true,useTrash: false}).then(()=>{},(r)=>{
        log('ERROR',`Failed to delete ${destDirUri.fsPath}`,r);
      });
      return {url:options,status:false};
    });

  }
}

export class WadGit {
  constructor(){

  }
}
export interface IGitErrorData {
	error?: Error;
	message?: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	gitErrorCode?: string;
	gitCommand?: string;
	gitArgs?: string[];
}

export class GitError {

	error?: Error;
	message: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	gitErrorCode?: string;
	gitCommand?: string;
	gitArgs?: string[];

	constructor(data: IGitErrorData) {
		if (data.error) {
			this.error = data.error;
			this.message = data.error.message;
		} else {
			this.error = undefined;
			this.message = '';
		}

		this.message = this.message || data.message || 'Git error';
		this.stdout = data.stdout;
		this.stderr = data.stderr;
		this.exitCode = data.exitCode;
		this.gitErrorCode = data.gitErrorCode;
		this.gitCommand = data.gitCommand;
		this.gitArgs = data.gitArgs;
	}

	toString(): string {
		let result = this.message + ' ' + JSON.stringify({
			exitCode: this.exitCode,
			gitErrorCode: this.gitErrorCode,
			gitCommand: this.gitCommand,
			stdout: this.stdout,
			stderr: this.stderr
		}, null, 2);

		if (this.error) {
			result += (<any>this.error).stack;
		}

		return result;
	}
}
function cpErrorHandler(cb: (reason?: any) => void): (reason?: any) => void {
	return err => {
		if (/ENOENT/.test(err.message)) {
			err = new GitError({
				error: err,
				message: 'Failed to execute git (ENOENT)',
				gitErrorCode: GitErrorCodes.NotAGitRepository
			});
		}

		cb(err);
	};
}
function parseVersion(raw: string): string {
	return raw.replace(/^git version /, '');
}

function findSpecificGit(path: string, onValidate: (path: string) => boolean): Promise<IGit> {
	return new Promise<IGit>((c, e) => {
		if (!onValidate(path)) {
			return e('git not found');
		}

		const buffers: Buffer[] = [];
		const child = cp.spawn(path, ['--version']);
		child.stdout.on('data', (b: Buffer) => buffers.push(b));
		child.on('error', cpErrorHandler(e));
		child.on('exit', code => code ? e(new Error('Not found')) : c({ path, version: parseVersion(Buffer.concat(buffers).toString('utf8').trim()) }));
	});
}

function findGitDarwin(onValidate: (path: string) => boolean): Promise<IGit> {
	return new Promise<IGit>((c, e) => {
		cp.exec('which git', (err, gitPathBuffer) => {
			if (err) {
				return e('git not found');
			}

			const path = gitPathBuffer.toString().trim();

			function getVersion(path: string) {
				if (!onValidate(path)) {
					return e('git not found');
				}

				// make sure git executes
				cp.exec('git --version', (err, stdout) => {

					if (err) {
						return e('git not found');
					}

					return c({ path, version: parseVersion(stdout.trim()) });
				});
			}

			if (path !== '/usr/bin/git') {
				return getVersion(path);
			}

			// must check if XCode is installed
			cp.exec('xcode-select -p', (err: any) => {
				if (err && err.code === 2) {
					// git is not installed, and launching /usr/bin/git
					// will prompt the user to install it

					return e('git not found');
				}

				getVersion(path);
			});
		});
	});
}

function findSystemGitWin32(base: string, onValidate: (path: string) => boolean): Promise<IGit> {
	if (!base) {
		return Promise.reject<IGit>('Not found');
	}

	return findSpecificGit(path.join(base, 'Git', 'cmd', 'git.exe'), onValidate);
}

function findGitWin32InPath(onValidate: (path: string) => boolean): Promise<IGit> {
	const whichPromise = new Promise<string>((c, e) => which('git.exe', (err, path) => err ? e(err) : c(path!)));
	return whichPromise.then(path => findSpecificGit(path, onValidate));
}

function findGitWin32(onValidate: (path: string) => boolean): Promise<IGit> {
	return findSystemGitWin32(process.env['ProgramW6432'] as string, onValidate)
		.then(undefined, () => findSystemGitWin32(process.env['ProgramFiles(x86)'] as string, onValidate))
		.then(undefined, () => findSystemGitWin32(process.env['ProgramFiles'] as string, onValidate))
		.then(undefined, () => findSystemGitWin32(path.join(process.env['LocalAppData'] as string, 'Programs'), onValidate))
		.then(undefined, () => findGitWin32InPath(onValidate));
}

export async function findGit(hints: string[], onValidate: (path: string) => boolean): Promise<IGit> {
	for (const hint of hints) {
		try {
			return await findSpecificGit(hint, onValidate);
		} catch {
			// noop
		}
	}

	try {
		switch (process.platform) {
			case 'darwin': return await findGitDarwin(onValidate);
			case 'win32': return await findGitWin32(onValidate);
			default: return await findSpecificGit('git', onValidate);
		}
	} catch {
		// noop
	}

	throw new Error('Git installation not found.');
}