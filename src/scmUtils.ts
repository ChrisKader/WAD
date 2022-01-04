import { extensions as Extensions, FileType, Uri, workspace as Workspace } from "vscode";
import { Git, GitExtension } from "./git";
import { join as Join } from 'path';
import { workspaceRecursiveCopy } from './util';
import { log } from "./msUtil";

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