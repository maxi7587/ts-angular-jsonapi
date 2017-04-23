import { IParamsCollection } from '../interfaces';

export interface IExecParams {
    id: string | null;
    params?: IParamsCollection | Function;
    fc_success?: Function;
    fc_error?: Function;
    exec_type: string;
}
