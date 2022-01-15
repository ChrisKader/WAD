import { Uri, FileType, workspace as Workspace, Disposable, Event } from 'vscode';
import { combinedDisposable, log } from './msutil';
import * as path from 'path';
import { dirname as Dirname } from 'path';

const iconsRootPath = path.join(__dirname, '..', 'resources', 'icons');

export function camelCase(str:string) {
  return str.split(' ')
     .map(a => a.trim())
     .map(a => a[0].toUpperCase() + a.substring(1))
     .join('');
}

export const regExObj = {
  oldReposRegex: /(?:.*(?<type>(?:git|svn|hg))(?<path>\.(?:curseforge|wowace)\.com\/.+)\/mainline(?<end>\/trunk)?)/,
  svnCheckRegex: /^(?:svn|.+):\/{2}.+\..+(?:(?:.+)?\/trunk\/?)/
};

export function getIconUri(iconName: string, theme: string): Uri {
  return Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}

export function toProperCase(s: string) {
  return s.replace(/\w\S*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
}
export async function workspaceRecursiveCopy(sourceDir: Uri, targetDir: Uri, ignore?: string[]): Promise<{ sourceDir: string, targetDir: string, complete: boolean, copyResults: string[][] }> {
  const sourceDirFs = sourceDir.fsPath;
  const targetDirFs = targetDir.fsPath;

  log(`Starting copy of ${sourceDirFs} to ${targetDirFs}`);

  let rtnObject = {
    sourceDir: sourceDirFs,
    targetDir: targetDirFs,
    complete: false,
    copyResults: <string[][]>[]
  };

  let sourceDirCheck;
  let targetDirCheck;
  try {
    sourceDirCheck = (await Workspace.fs.stat(sourceDir));
    targetDirCheck = (await Workspace.fs.stat(targetDir));
  } catch (e) {

  } finally {
    if ((!sourceDirCheck)) {
      const sourceDirRes = !sourceDirCheck ? `source directory ${sourceDir.fsPath}` : '';

      const finalString = `Cannot find ${sourceDirRes}`;
      log('ERROR',finalString);
      rtnObject.complete = false;
      return rtnObject;
    } else if ((sourceDirCheck && sourceDirCheck.type !== FileType.Directory) || (targetDirCheck && targetDirCheck.type !== FileType.Directory)) {
      const sourceDirTypeCheck = sourceDirCheck ? sourceDirCheck.type !== FileType.Directory : false;
      const targetDirDirTypeCheck = targetDirCheck ? targetDirCheck.type !== FileType.Directory : false;

      const sourceDirRes = sourceDirTypeCheck ? `source ${sourceDir.fsPath} directory` : '';
      const joinRes = sourceDirTypeCheck && targetDirDirTypeCheck ? ' and ' : '';
      const targetDirRes = targetDirDirTypeCheck ? `target ${targetDir.fsPath} directory` : '';

      const finalString = `Not a directory ${sourceDirRes}${joinRes}${targetDirRes}`;
      log('ERROR',finalString);
      rtnObject.complete = false;
      return rtnObject;
    }
  }

  log(`Reading source directory ${sourceDirFs}`);
  let copyFileList = [];
  return await Workspace.fs.readDirectory(sourceDir).then(async (results) => {
    for (let idx = 0; idx < results.length; idx++) {
      const [fileName, fileType] = results[idx];
      log(`Processing ${fileName} in directory ${sourceDirFs}`);
      const sourceFileUri = Uri.joinPath(sourceDir, '/', fileName);
      const targetFileUri = Uri.joinPath(targetDir, '/', fileName);

      let resultArray = [
        sourceFileUri.fsPath,
        targetFileUri.fsPath
      ];

      if (ignore && ignore.includes(fileName)) {
        log(`Skipping ${fileName} in directory ${sourceDirFs}`);
        resultArray.push('false');
        rtnObject.copyResults.push(resultArray);
        continue;
      }

      if(fileType === 0){
        log('ERROR',`Unknown file ${sourceFileUri.fsPath}`);
        resultArray.push('false');
      } else if(fileType === 1){
        log(`Copying file ${sourceFileUri.fsPath} to ${targetFileUri.fsPath}`);
        await Workspace.fs.copy(sourceFileUri, targetFileUri, { overwrite: true }).then(()=>{
          resultArray.push('true');
        },(r)=>{
          log('ERROR',`Failed to copy ${sourceFileUri.fsPath} to ${targetFileUri.fsPath}`);
          resultArray.push('false');
        });
      } else if(fileType === 2){
        log(`Copying directory ${sourceFileUri.fsPath} to ${targetFileUri.fsPath}`);
        await Workspace.fs.copy(sourceFileUri, targetFileUri, { overwrite: true }).then(()=>{
          resultArray.push('true');
        },(r)=>{
          log('ERROR',`Failed to copy ${sourceFileUri.fsPath} to ${targetFileUri.fsPath}`);
          resultArray.push('false');
        });
        //log(`Sending directory ${sourceFileUri.fsPath} to recursive copy.`);
          /* const dirCopyRes = await workspaceRecursiveCopy(sourceFileUri, targetFileUri);
          if (dirCopyRes.complete === true) {
            resultArray.push('true');
          } else {
            resultArray.push('false');
          }
          resultArray = resultArray.concat(...dirCopyRes.copyResults); */
      }
      rtnObject.copyResults.push(resultArray);
    }
    rtnObject.complete = true;
    return rtnObject;
  }, (r) => {
    log('ERROR',`Failed to read ${sourceDirFs}`,r);
    rtnObject.complete = false;
    return rtnObject;
  });
}

export function anyEventMore<T>(...events: [Event<T>,string][]): Event<T> {
	return (listener: (e: T,s: string) => any, thisArgs?: any, disposables?: Disposable[]) => {
		const result = combinedDisposable(events.map(([event,arg]) => event(i => listener.call(thisArgs, i,arg))));

		if (disposables) {
			disposables.push(result);
		}

		return result;
	};
}

export function checkPath(base: Uri, dest: Uri){
  // file:///c%3A/TESTFOLDER/TestAddon1/Addon.toc
  // file:///c%3A/TESTFOLDER/TestAddon1/TestAddon.toc
  return dest.toString(true).includes(Dirname(base.toString(true)))
}