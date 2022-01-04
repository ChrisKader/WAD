import {Uri} from 'vscode';
import * as path from "path";

const iconsRootPath = path.join(__dirname, "..", "resources", "icons");

function getIconUri(iconName: string, theme: string): Uri {
  return Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}