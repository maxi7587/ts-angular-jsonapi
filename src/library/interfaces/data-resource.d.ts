import { IAttributes } from '../interfaces';
import { ILinks } from '../interfaces/links.d';

interface IDataResource {
    type: string;
    id: string;
    attributes?: IAttributes;
    relationships?: any;
    links?: ILinks;
    meta?: any;
}
