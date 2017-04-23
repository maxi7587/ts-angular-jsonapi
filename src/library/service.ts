/// <reference path="./index.d.ts" />

// import * as Jsonapi from './core';
import { Core } from './core';
import { Base } from './services/base';
import { Resource } from './resource';
import { ParentResourceService } from './parent-resource-service';
import { PathBuilder } from './services/path-builder';
import { UrlParamsBuilder } from './services/url-params-builder';
import { Converter } from './services/resource-converter';
import { LocalFilter } from './services/localfilter';
import { MemoryCache } from './services/memorycache';

import { IService, ISchema, IResource, ICollection, IExecParams, ICache, IParamsCollection, IParamsResource } from './interfaces';

export class Service extends ParentResourceService implements IService {
    public is_new = true;
    public is_loading = false;
    public is_saving = false;
    public schema: ISchema;
    public memorycache: ICache;
    public type: string;

    private path: string;   // without slashes
    private smartfiltertype = 'undefined';

    /**
    Register schema on Core
    @return true if the resource don't exist and registered ok
    **/
    public register(): boolean {
        if (Core.Me === null) {
            throw 'Error: you are trying register --> ' + this.type + ' <-- before inject JsonapiCore somewhere, almost one time.';
        }
        // only when service is registered, not cloned object
        this.memorycache = new MemoryCache();
        return Core.Me._register(this);
    }

    // public new<T extends IResource>(): T {
    public new(id = ''): IResource {
        let resource: IResource = new Resource();
        resource.type = this.type;
        resource.id = id;
        return resource;
    }

    public getPrePath(): string {
        return '';
    }
    public getPath(): string {
        return this.path ? this.path : this.type;
    }

    public get<T extends IResource>(id, params?: IParamsResource | Function, fc_success?: Function, fc_error?: Function): T {
        // return this.__exec({ id, params, fc_success, fc_error, 'get' });
        return this.__exec({ id: id, params: params, fc_success: fc_success, fc_error: fc_error, exec_type: 'get' });
    }

    public delete(id: string, params?: Object | Function, fc_success?: Function, fc_error?: Function): void {
        // this.__exec(id, params, fc_success, fc_error, 'delete');
        return this.__exec({ id: id, params: params, fc_success: fc_success, fc_error: fc_error, exec_type: 'delete' });
    }

    public all(params?: IParamsCollection | Function, fc_success?: Function, fc_error?: Function): ICollection {
        return this.__exec({ id: null, params: params, fc_success: fc_success, fc_error: fc_error, exec_type: 'all' });
    }

    /**
    This method sort params for all(), get(), delete() and save()
    */
    protected __exec(exec_params: IExecParams): any {
        super.__exec(exec_params);

        this.schema = angular.extend({}, Base.Schema, this.schema);

        switch (exec_params.exec_type) {
            case 'get':
            return this._get(exec_params.id, exec_params.params, exec_params.fc_success, exec_params.fc_error);
            case 'delete':
            return this._delete(exec_params.id, exec_params.params, exec_params.fc_success, exec_params.fc_error);
            case 'all':
            return this._all(exec_params.params, exec_params.fc_success, exec_params.fc_error);
        }
    }

    public _get(id: string, params: IParamsResource, fc_success, fc_error): IResource {
        // http request
        let path = new PathBuilder();
        path.appendPath(this.getPrePath());
        path.appendPath(this.getPath());
        path.appendPath(id);
        params.include ? path.setInclude(params.include) : null;

        // cache
        let resource = Converter.newResource(this.type, id);
        resource.is_loading = true;
        // exit if ttl is not expired
        let temporal_ttl = params.ttl ? params.ttl : 0;
        if (this.getService().memorycache.isResourceLive(id, temporal_ttl)) {
            // we create a promise because we need return collection before
            // run success client function
            var deferred = Core.Services.$q.defer();
            deferred.resolve(fc_success);
            deferred.promise.then(fc_success => {
                this.runFc(fc_success, 'memorycache');
            });
            resource.is_loading = false;
            return resource;
        }


        Core.Services.JsonapiHttp
        .get(path.get())
        .then(
            success => {
                Converter.build(success.data, resource, this.schema);
                resource.is_loading = false;
                this.getService().memorycache.setResource(resource);
                this.runFc(fc_success, success);
            },
            error => {
                this.runFc(fc_error, error);
            }
        );

        return resource;
    }

    private _all(params: IParamsCollection, fc_success, fc_error): ICollection {

        // check smartfiltertype, and set on remotefilter
        if (params.smartfilter && this.smartfiltertype !== 'localfilter') {
            angular.extend(params.remotefilter, params.smartfilter);
        }

        // http request
        let path = new PathBuilder();
        let paramsurl = new UrlParamsBuilder();
        path.appendPath(this.getPrePath());
        params.beforepath ? path.appendPath(params.beforepath) : null;
        path.appendPath(this.getPath());
        params.include ? path.setInclude(params.include) : null;
        params.remotefilter ? path.addParam(paramsurl.toparams( { filter: params.remotefilter } )) : null;
        if (params.page) {
            params.page.number > 1 ? path.addParam(
                Core.Services.rsJsonapiConfig.parameters.page.number + '=' + params.page.number) : null;
            params.page.limit ? path.addParam(
                Core.Services.rsJsonapiConfig.parameters.page.limit + '=' + params.page.limit) : null;
        }

        // make request
        // if we remove this, dont work the same .all on same time (ej: <component /><component /><component />)
        let tempororay_collection = this.getService().memorycache.getCollection(path.getForCache());

        // MEMORY_CACHE
        let temporal_ttl = params.ttl ? params.ttl : this.schema.ttl;
        if (temporal_ttl >= 0 && this.getService().memorycache.isCollectionExist(path.getForCache())) {
            // get cached data and merge with temporal collection
            tempororay_collection.$source = 'memorycache';

            // check smartfiltertype, and set on localfilter
            if (params.smartfilter && this.smartfiltertype === 'localfilter') {
                angular.extend(params.localfilter, params.smartfilter);
            }

            // fill collection and localfilter
            let localfilter = new LocalFilter();
            tempororay_collection = localfilter.filterCollection(tempororay_collection, params.localfilter);

            // exit if ttl is not expired
            if (this.getService().memorycache.isCollectionLive(path.getForCache(), temporal_ttl)) {
                // we create a promise because we need return collection before
                // run success client function
                var deferred = Core.Services.$q.defer();
                deferred.resolve(fc_success);
                deferred.promise.then(fc_success => {
                    this.runFc(fc_success, 'memorycache');
                });
                return tempororay_collection;
            }
        }

        tempororay_collection['$isloading'] = true;

        // STORAGE_CACHE
        Core.Services.JsonapiHttpStorage
        .get(path.getForCache(), params.storage_ttl)
        .then(
            success => {
                tempororay_collection.$source = 'httpstorage';
                tempororay_collection.$isloading = false;
                Converter.build(success, tempororay_collection, this.schema);

                // localfilter getted data
                let localfilter = new LocalFilter();
                tempororay_collection = localfilter.filterCollection(tempororay_collection, params.localfilter);

                this.runFc(fc_success, { data: success});

                var deferred = Core.Services.$q.defer();
                deferred.resolve(fc_success);
                deferred.promise.then(fc_success => {
                    this.runFc(fc_success, 'httpstorage');
                });
                return tempororay_collection;
            },
            error => {
                this.getAllFromServer(path, params, fc_success, fc_error, tempororay_collection);
            }
        );

        return tempororay_collection;
    }

    private getAllFromServer(path, params, fc_success, fc_error, tempororay_collection: ICollection) {
        // SERVER REQUEST
        Core.Services.JsonapiHttp
        .get(path.get())
        .then(
            success => {
                tempororay_collection.$source = 'server';
                tempororay_collection.$isloading = false;

                Converter.build(success.data, tempororay_collection, this.schema);

                this.getService().memorycache.setCollection(path.getForCache(), tempororay_collection);

                if (params.storage_ttl > 0) {
                    Core.Services.JsonapiHttpStorage.save(path.getForCache(), success.data);
                }

                // localfilter getted data
                let localfilter = new LocalFilter();
                tempororay_collection = localfilter.filterCollection(tempororay_collection, params.localfilter);

                // trying to define smartfiltertype
                if (this.smartfiltertype === 'undefined') {
                    let page = tempororay_collection.page;
                    if (page.number === 1 && page.total_resources <= page.resources_per_page) {
                        this.smartfiltertype = 'localfilter';
                    } else if (page.number === 1 && page.total_resources > page.resources_per_page) {
                        this.smartfiltertype = 'remotefilter';
                    }
                }

                this.runFc(fc_success, success);
            },
            error => {
                tempororay_collection.$source = 'server';
                tempororay_collection.$isloading = false;
                this.runFc(fc_error, error);
            }
        );
    }

    private _delete(id: string, params, fc_success, fc_error): void {
        // http request
        let path = new PathBuilder();
        path.appendPath(this.getPrePath());
        path.appendPath(this.getPath());
        path.appendPath(id);

        Core.Services.JsonapiHttp
        .delete(path.get())
        .then(
            success => {
                // we don't use more temporary_collection
                // delete this.tempororay_collection[id];
                this.getService().memorycache.removeResource(id);
                this.runFc(fc_success, success);
            },
            error => {
                this.runFc(fc_error, error);
            }
        );
    }

    /**
    @return This resource like a service
    **/
    public getService() {
        return Converter.getService(this.type);
    }

    public clearMemoryCache() {
        return this.getService().memorycache.clearAllCollections();
    }
}
