import { Range, Location, TextDocument, Position, languages, workspace, window, SemanticTokens, DocumentSymbol, MarkdownString } from "vscode";
import { log } from "./msutil";

class TEscTypes {
  coloring:string = 'coloring';
  atlas:string= 'atlas';
  texture:string= 'texture';
}
 //'atlas'|'coloring'|'texture'

type IEscStrRef = {
  type: TEscTypes[keyof TEscTypes];
  value: string;
  valueRange: Range;
}

type TSuppEscTypes = {
  [Property in keyof TEscTypes as string]: {
    type: keyof TEscTypes,
    supported: boolean,
    check:{
      re: RegExp;
    }
    sub:{
      re:RegExp,
      rep:string,
    }
  };
};

export interface IEscStrsInfo {
  location: Location;
  escStrings: IEscStrRef[];
}

const supportedEscpStrs:TSuppEscTypes = {
  coloring: {
    type: 'coloring',
    supported: true,
    check: {
      re:/(["']).*(\|c[a-f0-9]{8}.+\|r.*\1)/gi
    },
    sub:{
      re: /\|c[a-f0-9]{2}([a-f0-9]{6})((?:[^|"\\]+|\|{2}|\\["])*)(?:\|r|(?=\|c[a-f0-9]{8}))(?=[^\n"]*")/gi,
      rep: `<span style='color:#$1;'>$2</span>`
    }
  },
  atlas: {
    type: 'atlas',
    supported: false,
    check: {
      re:/(["']).*(\|A[a-f0-9]{8}.+\|r.*\1)/gi
    },
    sub:{
      re: /(.*)/g,
      rep: '$1'
    }
  },
  texture: {
    type: 'texture',
    supported: false,
    check: {
      re:/(["']).*(\|A[a-f0-9]{8}.+\|r.*\1)/gi
    },
    sub:{
      re: /(.*)/g,
      rep: '$1'
    }
  },
}

export class LuaEscStrs {

  constructor() {}
  re = {
    allStrings: /(["']).*?\1/g,
    escStrTest: /((["'])\|[AcT].+?\2)/g,
  }

  private getStrings = (text: string) => {
    return [...text.matchAll(new RegExp(this.re.allStrings))]
  }

  private isEscStr = (text:string) => {
    return new RegExp(this.re.escStrTest).test(text)
  }

  private getEscStrs = (text:string) => {
    return this.getStrings(text).filter(a => this.isEscStr(a[0]))
  }

  private getEscStrType = (text:string) => {
   return Object.entries(supportedEscpStrs).find(([k,t])=>t.check.re.test(text))?.[0]
  }

  private getSupportedEscStrs = (doc:TextDocument,docTxt: string):IEscStrRef[] => {
    return this.getEscStrs(docTxt).map(e=>{
      const escType = this.getEscStrType(e[0])!
      const escStr = e[0]
      const escStrIdx = e.index!

      const escStrStart = doc.positionAt(escStrIdx)
      const escStrStartPos = new Position(escStrStart.line, escStrStart.character)

      const escStrEnd = doc.positionAt(escStrIdx + escStr.length)
      const escStrEndPos = new Position(escStrEnd.line, escStrEnd.character)
      const rtnVal = escStr.replace(supportedEscpStrs[escType]?.sub.re,supportedEscpStrs[escType]?.sub.rep)
      return {
        type: this.getEscStrType(e[0])!,
        valueRange: new Range(escStrStartPos,escStrEndPos),
        value: rtnVal.substring(1,rtnVal.length - 1)
      }
    }).filter(v=>supportedEscpStrs[v.type].supported)
  }

  parseDoc = (doc: TextDocument, docTxt = doc.getText()) => {
    if(doc.lineCount < 0){
      return;
    }
    return {
      location: new Location(doc.uri, new Range(doc.positionAt(0), doc.positionAt(1+docTxt.length + 1))),
      escStrings: this.getSupportedEscStrs(doc,docTxt)
    }
  }
}
