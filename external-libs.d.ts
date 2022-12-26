declare module "stats.js" {
  export class Stats {
    constructor(...args: any[]);
    [key: string]: any;
  }
  export default Stats;
}

declare module "dat.gui" {
  export class GUI {
    constructor(...args: any[]);
    [key: string]: any;
  }
}