/// <reference path="./_all.ts" />
(function (angular) {
    // Config
    angular.module('Jsonapi.config', [])
        .constant('rsJsonapiConfig', {
        url: 'http://yourdomain/api/v1/',
        delay: 0,
        unify_concurrency: true,
        cache_prerequests: true
    });
    angular.module('Jsonapi.services', []);
    angular.module('rsJsonapi', [
        'angular-storage',
        'Jsonapi.config',
        'Jsonapi.services'
    ]);
})(angular);

var Jsonapi;
(function (Jsonapi) {
    var Base = (function () {
        function Base() {
        }
        Base.Params = {
            id: '',
            include: []
        };
        Base.Schema = {
            attributes: {},
            relationships: {}
        };
        return Base;
    }());
    Jsonapi.Base = Base;
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var Http = (function () {
        /** @ngInject */
        Http.$inject = ["$http", "$timeout", "rsJsonapiConfig", "$q"];
        function Http($http, $timeout, rsJsonapiConfig, $q) {
            this.$http = $http;
            this.$timeout = $timeout;
            this.rsJsonapiConfig = rsJsonapiConfig;
            this.$q = $q;
        }
        Http.prototype.delete = function (path) {
            return this.exec(path, 'DELETE');
        };
        Http.prototype.get = function (path) {
            return this.exec(path, 'GET');
        };
        Http.prototype.exec = function (path, method, data) {
            var req = {
                method: method,
                url: this.rsJsonapiConfig.url + path,
                headers: {
                    'Content-Type': 'application/vnd.api+json'
                }
            };
            data && (req['data'] = data);
            var promise = this.$http(req);
            var deferred = this.$q.defer();
            var self = this;
            Jsonapi.Core.Me.refreshLoadings(1);
            promise.then(function (success) {
                // timeout just for develop environment
                self.$timeout(function () {
                    Jsonapi.Core.Me.refreshLoadings(-1);
                    deferred.resolve(success);
                }, self.rsJsonapiConfig.delay);
            }, function (error) {
                Jsonapi.Core.Me.refreshLoadings(-1);
                console.warn('Jsonapi.Http.exec error =>', error);
                if (error.status <= 0) {
                    // offline?
                    Jsonapi.Core.Me.loadingsError();
                }
                deferred.reject(error);
            });
            return deferred.promise;
        };
        return Http;
    }());
    Jsonapi.Http = Http;
    angular.module('Jsonapi.services').service('JsonapiHttp', Http);
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var PathMaker = (function () {
        function PathMaker() {
            this.paths = [];
            this.includes = [];
        }
        PathMaker.prototype.addPath = function (value) {
            this.paths.push(value);
        };
        PathMaker.prototype.setInclude = function (strings_array) {
            this.includes = strings_array;
        };
        PathMaker.prototype.get = function () {
            var get_params = [];
            if (this.includes.length > 0) {
                get_params.push('include=' + this.includes.join(','));
            }
            return this.paths.join('/') +
                (get_params.length > 0 ? '?' + get_params.join('&') : '');
        };
        return PathMaker;
    }());
    Jsonapi.PathMaker = PathMaker;
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var Converter = (function () {
        function Converter() {
        }
        /**
        Convert json arrays (like included) to an Resources arrays without [keys]
        **/
        Converter.json_array2resources_array = function (json_array, destination_array, // Array<Jsonapi.IResource>,
            use_id_for_key) {
            if (use_id_for_key === void 0) { use_id_for_key = false; }
            if (!destination_array) {
                destination_array = [];
            }
            var count = 0;
            for (var _i = 0, json_array_1 = json_array; _i < json_array_1.length; _i++) {
                var data = json_array_1[_i];
                var resource = Jsonapi.Converter.json2resource(data, false);
                if (use_id_for_key) {
                    destination_array[resource.id] = resource;
                }
                else {
                    // included for example need a extra parameter
                    destination_array[resource.type + '_' + resource.id] = resource;
                }
                count++;
            }
            // destination_array['$count'] = count; // problem with toArray or angular.forEach need a !isObject
            return destination_array;
        };
        /**
        Convert json arrays (like included) to an indexed Resources array by [type][id]
        **/
        Converter.json_array2resources_array_by_type = function (json_array, instance_relationships) {
            var all_resources = {};
            Converter.json_array2resources_array(json_array, all_resources, false);
            var resources = {};
            angular.forEach(all_resources, function (resource) {
                if (!(resource.type in resources)) {
                    resources[resource.type] = {};
                }
                resources[resource.type][resource.id] = resource;
            });
            return resources;
        };
        Converter.json2resource = function (json_resource, instance_relationships) {
            var resource_service = Jsonapi.Converter.getService(json_resource.type);
            if (resource_service) {
                return Jsonapi.Converter.procreate(resource_service, json_resource);
            }
            else {
                // service not registered
                console.warn('`' + json_resource.type + '`', 'service not found on json2resource()');
                var temp = new Jsonapi.Resource();
                temp.id = json_resource.id;
                temp.type = json_resource.type;
                return temp;
            }
        };
        Converter.getService = function (type) {
            var resource_service = Jsonapi.Core.Me.getResource(type);
            if (angular.isUndefined(resource_service)) {
                console.warn('`' + type + '`', 'service not found on getService()');
            }
            return resource_service;
        };
        /* return a resource type(resoruce_service) with data(data) */
        Converter.procreate = function (resource_service, data) {
            if (!('type' in data && 'id' in data)) {
                console.error('Jsonapi Resource is not correct', data);
            }
            var resource = new resource_service.constructor();
            resource.new();
            resource.id = data.id;
            resource.attributes = data.attributes ? data.attributes : {};
            resource.is_new = false;
            return resource;
        };
        Converter.build = function (document_from, resource_dest, schema) {
            // instancio los include y los guardo en included arrary
            var included = {};
            if ('included' in document_from) {
                included = Converter.json_array2resources_array_by_type(document_from.included, false);
            }
            if (angular.isArray(document_from.data)) {
                Converter._buildResources(document_from, resource_dest, schema, included);
            }
            else {
                Converter._buildResource(document_from.data, resource_dest, schema, included);
            }
        };
        Converter._buildResources = function (document_from, resource_dest, schema, included) {
            for (var _i = 0, _a = document_from.data; _i < _a.length; _i++) {
                var data = _a[_i];
                var resource = Jsonapi.Converter.getService(data.type);
                if (!(data.id in resource_dest)) {
                    resource_dest[data.id] = new resource.constructor();
                    resource_dest[data.id].reset();
                }
                Converter._buildResource(data, resource_dest[data.id], schema, included);
            }
        };
        Converter._buildResource = function (document_from, resource_dest, schema, included) {
            resource_dest.attributes = document_from.attributes;
            resource_dest.id = document_from.id;
            resource_dest.is_new = false;
            Converter.__buildRelationships(document_from.relationships, resource_dest.relationships, included, schema);
        };
        Converter.__buildRelationships = function (relationships_from, relationships_dest, included_array, schema) {
            // recorro los relationships levanto el service correspondiente
            angular.forEach(relationships_from, function (relation_value, relation_key) {
                // relation is in schema? have data or just links?
                if (!(relation_key in relationships_dest) && ('data' in relation_value)) {
                    relationships_dest[relation_key] = { data: [] };
                }
                // sometime data=null or simple { }
                if (!relation_value.data)
                    return;
                if (schema.relationships[relation_key] && schema.relationships[relation_key].hasMany) {
                    if (relation_value.data.length < 1)
                        return;
                    var resource_service = Jsonapi.Converter.getService(relation_value.data[0].type);
                    if (resource_service) {
                        relationships_dest[relation_key].data = {}; // force to object (not array)
                        angular.forEach(relation_value.data, function (relation_value) {
                            var tmp = Converter.__buildRelationship(relation_value, included_array);
                            relationships_dest[relation_key].data[tmp.id] = tmp;
                        });
                    }
                }
                else {
                    relationships_dest[relation_key].data = Converter.__buildRelationship(relation_value.data, included_array);
                }
            });
        };
        Converter.__buildRelationship = function (relation, included_array) {
            if (relation.type in included_array &&
                relation.id in included_array[relation.type]) {
                // it's in included
                return included_array[relation.type][relation.id];
            }
            else {
                // resource not included, return directly the object
                return relation;
            }
        };
        return Converter;
    }());
    Jsonapi.Converter = Converter;
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var Core = (function () {
        /** @ngInject */
        Core.$inject = ["rsJsonapiConfig", "JsonapiCoreServices"];
        function Core(rsJsonapiConfig, JsonapiCoreServices) {
            this.rsJsonapiConfig = rsJsonapiConfig;
            this.JsonapiCoreServices = JsonapiCoreServices;
            this.rootPath = 'http://reyesoft.ddns.net:9999/api/v1/companies/2';
            this.resources = [];
            this.loadingsCounter = 0;
            this.loadingsStart = function () { };
            this.loadingsDone = function () { };
            this.loadingsError = function () { };
            Jsonapi.Core.Me = this;
            Jsonapi.Core.Services = JsonapiCoreServices;
        }
        Core.prototype._register = function (clase) {
            if (clase.type in this.resources) {
                return false;
            }
            this.resources[clase.type] = clase;
            return true;
        };
        Core.prototype.getResource = function (type) {
            return this.resources[type];
        };
        Core.prototype.refreshLoadings = function (factor) {
            this.loadingsCounter += factor;
            if (this.loadingsCounter === 0) {
                this.loadingsDone();
            }
            else if (this.loadingsCounter === 1) {
                this.loadingsStart();
            }
        };
        Core.Me = null;
        Core.Services = null;
        return Core;
    }());
    Jsonapi.Core = Core;
    angular.module('Jsonapi.services').service('JsonapiCore', Core);
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var Resource = (function () {
        function Resource() {
            this.is_new = true;
            this.relationships = {}; //[];
        }
        Resource.prototype.clone = function () {
            var cloneObj = new this.constructor();
            for (var attribut in this) {
                if (typeof this[attribut] !== 'object') {
                    cloneObj[attribut] = this[attribut];
                }
            }
            return cloneObj;
        };
        /**
        Register schema on Jsonapi.Core
        @return true if the resource don't exist and registered ok
        **/
        Resource.prototype.register = function () {
            if (Jsonapi.Core.Me === null) {
                throw 'Error: you are trying register --> ' + this.type + ' <-- before inject JsonapiCore somewhere, almost one time.';
            }
            // only when service is registered, not cloned object
            this.cache = {};
            return Jsonapi.Core.Me._register(this);
        };
        Resource.prototype.getPath = function () {
            return this.path ? this.path : this.type;
        };
        // empty self object
        Resource.prototype.new = function () {
            var resource = this.clone();
            resource.reset();
            return resource;
        };
        Resource.prototype.reset = function () {
            var self = this;
            this.id = '';
            this.attributes = {};
            this.relationships = {};
            angular.forEach(this.schema.relationships, function (value, key) {
                self.relationships[key] = {};
                self.relationships[key]['data'] = {};
            });
            this.is_new = true;
        };
        Resource.prototype.toObject = function (params) {
            var _this = this;
            params = angular.extend({}, Jsonapi.Base.Params, params);
            this.schema = angular.extend({}, Jsonapi.Base.Schema, this.schema);
            var relationships = {};
            var included = [];
            var included_ids = []; //just for control don't repeat any resource
            // agrego cada relationship
            angular.forEach(this.relationships, function (relationship, relation_alias) {
                if (_this.schema.relationships[relation_alias] && _this.schema.relationships[relation_alias].hasMany) {
                    relationships[relation_alias] = { data: [] };
                    angular.forEach(relationship.data, function (resource) {
                        var reational_object = { id: resource.id, type: resource.type };
                        relationships[relation_alias]['data'].push(reational_object);
                        // no se agregó aún a included && se ha pedido incluir con el parms.include
                        var temporal_id = resource.type + '_' + resource.id;
                        if (included_ids.indexOf(temporal_id) === -1 && params.include.indexOf(relation_alias) !== -1) {
                            included_ids.push(temporal_id);
                            included.push(resource.toObject({}).data);
                        }
                    });
                }
                else {
                    if (!('id' in relationship.data)) {
                        console.warn(relation_alias + ' defined with hasMany:false, but I have a collection');
                    }
                    relationships[relation_alias] = { data: { id: relationship.data.id, type: relationship.data.type } };
                    // no se agregó aún a included && se ha pedido incluir con el parms.include
                    var temporal_id = relationship.data.type + '_' + relationship.data.id;
                    if (included_ids.indexOf(temporal_id) === -1 && params.include.indexOf(relationship.data.type) !== -1) {
                        included_ids.push(temporal_id);
                        included.push(relationship.data.toObject({}).data);
                    }
                }
            });
            var ret = {
                data: {
                    type: this.type,
                    id: this.id,
                    attributes: this.attributes,
                    relationships: relationships
                }
            };
            if (included.length > 0) {
                ret.included = included;
            }
            return ret;
        };
        Resource.prototype.get = function (id, params, fc_success, fc_error) {
            return this.__exec(id, params, fc_success, fc_error, 'get');
        };
        Resource.prototype.delete = function (id, params, fc_success, fc_error) {
            this.__exec(id, params, fc_success, fc_error, 'delete');
        };
        Resource.prototype.all = function (params, fc_success, fc_error) {
            return this.__exec(null, params, fc_success, fc_error, 'all');
        };
        Resource.prototype.save = function (params, fc_success, fc_error) {
            return this.__exec(null, params, fc_success, fc_error, 'save');
        };
        /**
        This method sort params for new(), get() and update()
        */
        Resource.prototype.__exec = function (id, params, fc_success, fc_error, exec_type) {
            // makes `params` optional
            if (angular.isFunction(params)) {
                fc_error = fc_success;
                fc_success = params;
                params = Jsonapi.Base.Params;
            }
            else {
                if (angular.isUndefined(params)) {
                    params = Jsonapi.Base.Params;
                }
                else {
                    params = angular.extend({}, Jsonapi.Base.Params, params);
                }
            }
            fc_success = angular.isFunction(fc_success) ? fc_success : function () { };
            fc_error = angular.isFunction(fc_error) ? fc_error : function () { };
            this.schema = angular.extend({}, Jsonapi.Base.Schema, this.schema);
            switch (exec_type) {
                case 'get':
                    return this._get(id, params, fc_success, fc_error);
                case 'delete':
                    return this._delete(id, params, fc_success, fc_error);
                case 'all':
                    return this._all(params, fc_success, fc_error);
                case 'save':
                    return this._save(params, fc_success, fc_error);
            }
        };
        Resource.prototype._get = function (id, params, fc_success, fc_error) {
            var _this = this;
            // http request
            var path = new Jsonapi.PathMaker();
            path.addPath(this.getPath());
            path.addPath(id);
            params.include ? path.setInclude(params.include) : null;
            var resource = this.getService().cache && this.getService().cache[id] ? this.getService().cache[id] : this.new();
            Jsonapi.Core.Services.JsonapiHttp
                .get(path.get())
                .then(function (success) {
                Jsonapi.Converter.build(success.data, resource, _this.schema);
                _this.fillCacheResource(resource);
                fc_success(success);
            }, function (error) {
                fc_error(error);
            });
            return resource;
        };
        Resource.prototype._all = function (params, fc_success, fc_error) {
            var _this = this;
            // http request
            var path = new Jsonapi.PathMaker();
            path.addPath(this.getPath());
            params.include ? path.setInclude(params.include) : null;
            // make request
            var resource = {};
            if (this.getService().cache) {
                // we don't make
                angular.forEach(this.getService().cache, function (value, key) {
                    resource[key] = value;
                });
            }
            Jsonapi.Core.Services.JsonapiHttp
                .get(path.get())
                .then(function (success) {
                Jsonapi.Converter.build(success.data, resource, _this.schema);
                _this.fillCache(resource);
                fc_success(success);
            }, function (error) {
                fc_error(error);
            });
            return resource;
        };
        Resource.prototype._delete = function (id, params, fc_success, fc_error) {
            // http request
            var path = new Jsonapi.PathMaker();
            path.addPath(this.getPath());
            path.addPath(id);
            Jsonapi.Core.Services.JsonapiHttp
                .delete(path.get())
                .then(function (success) {
                fc_success(success);
            }, function (error) {
                fc_error(error);
            });
        };
        Resource.prototype._save = function (params, fc_success, fc_error) {
            var object = this.toObject(params);
            // http request
            var path = new Jsonapi.PathMaker();
            path.addPath(this.getPath());
            this.id && path.addPath(this.id);
            params.include ? path.setInclude(params.include) : null;
            var resource = this.new();
            var promise = Jsonapi.Core.Services.JsonapiHttp.exec(path.get(), this.id ? 'PUT' : 'POST', object);
            promise.then(function (success) {
                var value = success.data.data;
                resource.attributes = value.attributes;
                resource.id = value.id;
                fc_success(success);
            }, function (error) {
                fc_error('data' in error ? error.data : error);
            });
            return resource;
        };
        Resource.prototype.addRelationship = function (resource, type_alias) {
            type_alias = (type_alias ? type_alias : resource.type);
            if (!(type_alias in this.relationships)) {
                this.relationships[type_alias] = { data: {} };
            }
            var object_key = resource.id;
            if (!object_key) {
                object_key = 'new_' + (Math.floor(Math.random() * 100000));
            }
            this.relationships[type_alias]['data'][object_key] = resource;
        };
        Resource.prototype.removeRelationship = function (type_alias, id) {
            if (!(type_alias in this.relationships)) {
                return false;
            }
            if (!('data' in this.relationships[type_alias])) {
                return false;
            }
            if (!(id in this.relationships[type_alias]['data'])) {
                return false;
            }
            delete this.relationships[type_alias]['data'][id];
            return true;
        };
        Resource.prototype.fillCache = function (resources) {
            if (resources.id) {
                this.fillCacheResource(resources);
            }
            else {
                this.fillCacheResources(resources);
            }
        };
        Resource.prototype.fillCacheResources = function (resources) {
            var _this = this;
            angular.forEach(resources, function (resource) {
                _this.fillCacheResource(resource);
            });
        };
        Resource.prototype.fillCacheResource = function (resource) {
            if (resource.id)
                this.getService().cache[resource.id] = resource;
        };
        /**
        @return This resource like a service
        **/
        Resource.prototype.getService = function () {
            return Jsonapi.Converter.getService(this.type);
        };
        return Resource;
    }());
    Jsonapi.Resource = Resource;
})(Jsonapi || (Jsonapi = {}));

/// <reference path="../../typings/main.d.ts" />
// Jsonapi interfaces part of top level
/// <reference path="./interfaces/document.d.ts"/>
/// <reference path="./interfaces/data-collection.d.ts"/>
/// <reference path="./interfaces/data-object.d.ts"/>
/// <reference path="./interfaces/data-resource.d.ts"/>
/// <reference path="./interfaces/params.d.ts"/>
/// <reference path="./interfaces/errors.d.ts"/>
/// <reference path="./interfaces/links.d.ts"/>
// Parameters for TS-Jsonapi Classes
/// <reference path="./interfaces/schema.d.ts"/>
// TS-Jsonapi Classes Interfaces
/// <reference path="./interfaces/core.d.ts"/>
/// <reference path="./interfaces/resource.d.ts"/>
// TS-Jsonapi classes
/// <reference path="./app.module.ts"/>
/// <reference path="./services/base.ts"/>
/// <reference path="./services/http.service.ts"/>
/// <reference path="./services/path-maker.ts"/>
/// <reference path="./services/resource-converter.ts"/>
//// <reference path="./services/core-services.service.ts"/>
/// <reference path="./core.ts"/>
/// <reference path="./resource.ts"/>

var Jsonapi;
(function (Jsonapi) {
    var CoreServices = (function () {
        /** @ngInject */
        CoreServices.$inject = ["JsonapiHttp"];
        function CoreServices(JsonapiHttp) {
            this.JsonapiHttp = JsonapiHttp;
        }
        return CoreServices;
    }());
    Jsonapi.CoreServices = CoreServices;
    angular.module('Jsonapi.services').service('JsonapiCoreServices', CoreServices);
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var JsonapiParser = (function () {
        /** @ngInject */
        function JsonapiParser() {
        }
        JsonapiParser.prototype.toObject = function (json_string) {
            return json_string;
        };
        return JsonapiParser;
    }());
    Jsonapi.JsonapiParser = JsonapiParser;
})(Jsonapi || (Jsonapi = {}));

var Jsonapi;
(function (Jsonapi) {
    var JsonapiStorage = (function () {
        /** @ngInject */
        function JsonapiStorage() {
        }
        JsonapiStorage.prototype.get = function (key) {
            /* let data = this.store.get(key);
            return angular.fromJson(data);*/
        };
        JsonapiStorage.prototype.merge = function (key, data) {
            /* let actual_data = this.get(key);
            let actual_info = angular.fromJson(actual_data); */
        };
        return JsonapiStorage;
    }());
    Jsonapi.JsonapiStorage = JsonapiStorage;
})(Jsonapi || (Jsonapi = {}));

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFwcC5tb2R1bGUudHMiLCJhcHAubW9kdWxlLmpzIiwic2VydmljZXMvYmFzZS50cyIsInNlcnZpY2VzL2Jhc2UuanMiLCJzZXJ2aWNlcy9odHRwLnNlcnZpY2UudHMiLCJzZXJ2aWNlcy9odHRwLnNlcnZpY2UuanMiLCJzZXJ2aWNlcy9wYXRoLW1ha2VyLnRzIiwic2VydmljZXMvcGF0aC1tYWtlci5qcyIsInNlcnZpY2VzL3Jlc291cmNlLWNvbnZlcnRlci50cyIsInNlcnZpY2VzL3Jlc291cmNlLWNvbnZlcnRlci5qcyIsImNvcmUudHMiLCJjb3JlLmpzIiwicmVzb3VyY2UudHMiLCJyZXNvdXJjZS5qcyIsIl9hbGwudHMiLCJfYWxsLmpzIiwic2VydmljZXMvY29yZS1zZXJ2aWNlcy5zZXJ2aWNlLnRzIiwic2VydmljZXMvY29yZS1zZXJ2aWNlcy5zZXJ2aWNlLmpzIiwic2VydmljZXMvanNvbmFwaS1wYXJzZXIuc2VydmljZS50cyIsInNlcnZpY2VzL2pzb25hcGktcGFyc2VyLnNlcnZpY2UuanMiLCJzZXJ2aWNlcy9qc29uYXBpLXN0b3JhZ2Uuc2VydmljZS50cyIsInNlcnZpY2VzL2pzb25hcGktc3RvcmFnZS5zZXJ2aWNlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FBRUEsQ0FBQyxVQUFVLFNBQU87O0lBRWQsUUFBUSxPQUFPLGtCQUFrQjtTQUNoQyxTQUFTLG1CQUFtQjtRQUN6QixLQUFLO1FBQ0wsT0FBTztRQUNQLG1CQUFtQjtRQUNuQixtQkFBbUI7O0lBR3ZCLFFBQVEsT0FBTyxvQkFBb0I7SUFFbkMsUUFBUSxPQUFPLGFBQWE7UUFDeEI7UUFDQTtRQUNBOztHQUdMO0FDSEg7QUNqQkEsSUFBTztBQUFQLENBQUEsVUFBTyxTQUFRO0lBQ1gsSUFBQSxRQUFBLFlBQUE7UUFBQSxTQUFBLE9BQUE7O1FBQ1csS0FBQSxTQUEwQjtZQUM3QixJQUFJO1lBQ0osU0FBUzs7UUFHTixLQUFBLFNBQVM7WUFDWixZQUFZO1lBQ1osZUFB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WC9ELFlBQUEsVUFBTztBQ1lkO0FDWkEsSUFBTztBQUFQLENBQUEsVUFBTyxTQUFRO0lBQ1gsSUFBQSxpQkFBQSxZQUFBOztRQUdJLFNBQUEsZ0JBQUE7O1FBSU8sY0FBQSxVQUFBLFdBQVAsVUFBZ0IsYUFBbUI7WUFDL0IsT0FBTzs7UUFFZixPQUFBOztJQVZhLFFBQUEsZ0JBQWE7R0FEdkIsWUFBQSxVQUFPO0FDYWQ7QUNiQSxJQUFPO0FBQVAsQ0FBQSxVQUFPLFNBQVE7SUFDWCxJQUFBLGtCQUFBLFlBQUE7O1FBR0ksU0FBQSxpQkFBQTs7UUFPTyxlQUFBLFVBQUEsTUFBUCxVQUFXLEtBQUc7Ozs7UUFLUCxlQUFBLFVBQUEsUUFBUCxVQUFhLEtBQUssTUFBSTs7OztRQU0xQixPQUFBOztJQXJCYSxRQUFBLGlCQUFjO0dBRHhCLFlBQUEsVUFBTztBQ2tCZCIsImZpbGUiOiJ0cy1hbmd1bGFyLWpzb25hcGkuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9fYWxsLnRzXCIgLz5cblxuKGZ1bmN0aW9uIChhbmd1bGFyKSB7XG4gICAgLy8gQ29uZmlnXG4gICAgYW5ndWxhci5tb2R1bGUoJ0pzb25hcGkuY29uZmlnJywgW10pXG4gICAgLmNvbnN0YW50KCdyc0pzb25hcGlDb25maWcnLCB7XG4gICAgICAgIHVybDogJ2h0dHA6Ly95b3VyZG9tYWluL2FwaS92MS8nLFxuICAgICAgICBkZWxheTogMCxcbiAgICAgICAgdW5pZnlfY29uY3VycmVuY3k6IHRydWUsXG4gICAgICAgIGNhY2hlX3ByZXJlcXVlc3RzOiB0cnVlXG4gICAgfSk7XG5cbiAgICBhbmd1bGFyLm1vZHVsZSgnSnNvbmFwaS5zZXJ2aWNlcycsIFtdKTtcblxuICAgIGFuZ3VsYXIubW9kdWxlKCdyc0pzb25hcGknLCBbXG4gICAgICAgICdhbmd1bGFyLXN0b3JhZ2UnLFxuICAgICAgICAnSnNvbmFwaS5jb25maWcnLFxuICAgICAgICAnSnNvbmFwaS5zZXJ2aWNlcydcbiAgICBdKTtcblxufSkoYW5ndWxhcik7XG4iLCIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9fYWxsLnRzXCIgLz5cbihmdW5jdGlvbiAoYW5ndWxhcikge1xuICAgIC8vIENvbmZpZ1xuICAgIGFuZ3VsYXIubW9kdWxlKCdKc29uYXBpLmNvbmZpZycsIFtdKVxuICAgICAgICAuY29uc3RhbnQoJ3JzSnNvbmFwaUNvbmZpZycsIHtcbiAgICAgICAgdXJsOiAnaHR0cDovL3lvdXJkb21haW4vYXBpL3YxLycsXG4gICAgICAgIGRlbGF5OiAwLFxuICAgICAgICB1bmlmeV9jb25jdXJyZW5jeTogdHJ1ZSxcbiAgICAgICAgY2FjaGVfcHJlcmVxdWVzdHM6IHRydWVcbiAgICB9KTtcbiAgICBhbmd1bGFyLm1vZHVsZSgnSnNvbmFwaS5zZXJ2aWNlcycsIFtdKTtcbiAgICBhbmd1bGFyLm1vZHVsZSgncnNKc29uYXBpJywgW1xuICAgICAgICAnYW5ndWxhci1zdG9yYWdlJyxcbiAgICAgICAgJ0pzb25hcGkuY29uZmlnJyxcbiAgICAgICAgJ0pzb25hcGkuc2VydmljZXMnXG4gICAgXSk7XG59KShhbmd1bGFyKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgQmFzZSB7XG4gICAgICAgIHN0YXRpYyBQYXJhbXM6IEpzb25hcGkuSVBhcmFtcyA9IHtcbiAgICAgICAgICAgIGlkOiAnJyxcbiAgICAgICAgICAgIGluY2x1ZGU6IFtdXG4gICAgICAgIH07XG5cbiAgICAgICAgc3RhdGljIFNjaGVtYSA9IHtcbiAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHt9LFxuICAgICAgICAgICAgcmVsYXRpb25zaGlwczoge31cbiAgICAgICAgfTtcbiAgICB9XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBCYXNlID0gKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgZnVuY3Rpb24gQmFzZSgpIHtcbiAgICAgICAgfVxuICAgICAgICBCYXNlLlBhcmFtcyA9IHtcbiAgICAgICAgICAgIGlkOiAnJyxcbiAgICAgICAgICAgIGluY2x1ZGU6IFtdXG4gICAgICAgIH07XG4gICAgICAgIEJhc2UuU2NoZW1hID0ge1xuICAgICAgICAgICAgYXR0cmlidXRlczoge30sXG4gICAgICAgICAgICByZWxhdGlvbnNoaXBzOiB7fVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gQmFzZTtcbiAgICB9KCkpO1xuICAgIEpzb25hcGkuQmFzZSA9IEJhc2U7XG59KShKc29uYXBpIHx8IChKc29uYXBpID0ge30pKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgSHR0cCB7XG5cbiAgICAgICAgLyoqIEBuZ0luamVjdCAqL1xuICAgICAgICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgICAgICAgICBwcm90ZWN0ZWQgJGh0dHAsXG4gICAgICAgICAgICBwcm90ZWN0ZWQgJHRpbWVvdXQsXG4gICAgICAgICAgICBwcm90ZWN0ZWQgcnNKc29uYXBpQ29uZmlnLFxuICAgICAgICAgICAgcHJvdGVjdGVkICRxXG4gICAgICAgICkge1xuXG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgZGVsZXRlKHBhdGg6IHN0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZXhlYyhwYXRoLCAnREVMRVRFJyk7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgZ2V0KHBhdGg6IHN0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZXhlYyhwYXRoLCAnR0VUJyk7XG4gICAgICAgIH1cblxuICAgICAgICBwcm90ZWN0ZWQgZXhlYyhwYXRoOiBzdHJpbmcsIG1ldGhvZDogc3RyaW5nLCBkYXRhPzogSnNvbmFwaS5JRGF0YU9iamVjdCkge1xuICAgICAgICAgICAgbGV0IHJlcSA9IHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICAgICAgICB1cmw6IHRoaXMucnNKc29uYXBpQ29uZmlnLnVybCArIHBhdGgsXG4gICAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3ZuZC5hcGkranNvbidcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgZGF0YSAmJiAocmVxWydkYXRhJ10gPSBkYXRhKTtcbiAgICAgICAgICAgIGxldCBwcm9taXNlID0gdGhpcy4kaHR0cChyZXEpO1xuXG4gICAgICAgICAgICBsZXQgZGVmZXJyZWQgPSB0aGlzLiRxLmRlZmVyKCk7XG4gICAgICAgICAgICBsZXQgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgICBKc29uYXBpLkNvcmUuTWUucmVmcmVzaExvYWRpbmdzKDEpO1xuICAgICAgICAgICAgcHJvbWlzZS50aGVuKFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3MgPT4ge1xuICAgICAgICAgICAgICAgICAgICAvLyB0aW1lb3V0IGp1c3QgZm9yIGRldmVsb3AgZW52aXJvbm1lbnRcbiAgICAgICAgICAgICAgICAgICAgc2VsZi4kdGltZW91dCggKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgSnNvbmFwaS5Db3JlLk1lLnJlZnJlc2hMb2FkaW5ncygtMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBkZWZlcnJlZC5yZXNvbHZlKHN1Y2Nlc3MpO1xuICAgICAgICAgICAgICAgICAgICB9LCBzZWxmLnJzSnNvbmFwaUNvbmZpZy5kZWxheSk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIEpzb25hcGkuQ29yZS5NZS5yZWZyZXNoTG9hZGluZ3MoLTEpO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ0pzb25hcGkuSHR0cC5leGVjIGVycm9yID0+JywgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3Iuc3RhdHVzIDw9IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG9mZmxpbmU/XG4gICAgICAgICAgICAgICAgICAgICAgICBKc29uYXBpLkNvcmUuTWUubG9hZGluZ3NFcnJvcigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGRlZmVycmVkLnJlamVjdChlcnJvcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuICAgICAgICB9XG4gICAgfVxuICAgIGFuZ3VsYXIubW9kdWxlKCdKc29uYXBpLnNlcnZpY2VzJykuc2VydmljZSgnSnNvbmFwaUh0dHAnLCBIdHRwKTtcbn1cbiIsInZhciBKc29uYXBpO1xuKGZ1bmN0aW9uIChKc29uYXBpKSB7XG4gICAgdmFyIEh0dHAgPSAoZnVuY3Rpb24gKCkge1xuICAgICAgICAvKiogQG5nSW5qZWN0ICovXG4gICAgICAgIGZ1bmN0aW9uIEh0dHAoJGh0dHAsICR0aW1lb3V0LCByc0pzb25hcGlDb25maWcsICRxKSB7XG4gICAgICAgICAgICB0aGlzLiRodHRwID0gJGh0dHA7XG4gICAgICAgICAgICB0aGlzLiR0aW1lb3V0ID0gJHRpbWVvdXQ7XG4gICAgICAgICAgICB0aGlzLnJzSnNvbmFwaUNvbmZpZyA9IHJzSnNvbmFwaUNvbmZpZztcbiAgICAgICAgICAgIHRoaXMuJHEgPSAkcTtcbiAgICAgICAgfVxuICAgICAgICBIdHRwLnByb3RvdHlwZS5kZWxldGUgPSBmdW5jdGlvbiAocGF0aCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZXhlYyhwYXRoLCAnREVMRVRFJyk7XG4gICAgICAgIH07XG4gICAgICAgIEh0dHAucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5leGVjKHBhdGgsICdHRVQnKTtcbiAgICAgICAgfTtcbiAgICAgICAgSHR0cC5wcm90b3R5cGUuZXhlYyA9IGZ1bmN0aW9uIChwYXRoLCBtZXRob2QsIGRhdGEpIHtcbiAgICAgICAgICAgIHZhciByZXEgPSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICAgICAgdXJsOiB0aGlzLnJzSnNvbmFwaUNvbmZpZy51cmwgKyBwYXRoLFxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi92bmQuYXBpK2pzb24nXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGRhdGEgJiYgKHJlcVsnZGF0YSddID0gZGF0YSk7XG4gICAgICAgICAgICB2YXIgcHJvbWlzZSA9IHRoaXMuJGh0dHAocmVxKTtcbiAgICAgICAgICAgIHZhciBkZWZlcnJlZCA9IHRoaXMuJHEuZGVmZXIoKTtcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgICAgIEpzb25hcGkuQ29yZS5NZS5yZWZyZXNoTG9hZGluZ3MoMSk7XG4gICAgICAgICAgICBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAvLyB0aW1lb3V0IGp1c3QgZm9yIGRldmVsb3AgZW52aXJvbm1lbnRcbiAgICAgICAgICAgICAgICBzZWxmLiR0aW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgSnNvbmFwaS5Db3JlLk1lLnJlZnJlc2hMb2FkaW5ncygtMSk7XG4gICAgICAgICAgICAgICAgICAgIGRlZmVycmVkLnJlc29sdmUoc3VjY2Vzcyk7XG4gICAgICAgICAgICAgICAgfSwgc2VsZi5yc0pzb25hcGlDb25maWcuZGVsYXkpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgSnNvbmFwaS5Db3JlLk1lLnJlZnJlc2hMb2FkaW5ncygtMSk7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdKc29uYXBpLkh0dHAuZXhlYyBlcnJvciA9PicsIGVycm9yKTtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3Iuc3RhdHVzIDw9IDApIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gb2ZmbGluZT9cbiAgICAgICAgICAgICAgICAgICAgSnNvbmFwaS5Db3JlLk1lLmxvYWRpbmdzRXJyb3IoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmZXJyZWQucmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiBIdHRwO1xuICAgIH0oKSk7XG4gICAgSnNvbmFwaS5IdHRwID0gSHR0cDtcbiAgICBhbmd1bGFyLm1vZHVsZSgnSnNvbmFwaS5zZXJ2aWNlcycpLnNlcnZpY2UoJ0pzb25hcGlIdHRwJywgSHR0cCk7XG59KShKc29uYXBpIHx8IChKc29uYXBpID0ge30pKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgUGF0aE1ha2VyIHtcbiAgICAgICAgcHVibGljIHBhdGhzOiBBcnJheTxTdHJpbmc+ID0gW107XG4gICAgICAgIHB1YmxpYyBpbmNsdWRlczogQXJyYXk8U3RyaW5nPiA9IFtdO1xuXG4gICAgICAgIHB1YmxpYyBhZGRQYXRoKHZhbHVlOiBTdHJpbmcpIHtcbiAgICAgICAgICAgIHRoaXMucGF0aHMucHVzaCh2YWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgc2V0SW5jbHVkZShzdHJpbmdzX2FycmF5OiBBcnJheTxTdHJpbmc+KSB7XG4gICAgICAgICAgICB0aGlzLmluY2x1ZGVzID0gc3RyaW5nc19hcnJheTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBnZXQoKTogU3RyaW5nIHtcbiAgICAgICAgICAgIGxldCBnZXRfcGFyYW1zOiBBcnJheTxTdHJpbmc+ID0gW107XG5cbiAgICAgICAgICAgIGlmICh0aGlzLmluY2x1ZGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBnZXRfcGFyYW1zLnB1c2goJ2luY2x1ZGU9JyArIHRoaXMuaW5jbHVkZXMuam9pbignLCcpKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMucGF0aHMuam9pbignLycpICtcbiAgICAgICAgICAgICAgICAoZ2V0X3BhcmFtcy5sZW5ndGggPiAwID8gJz8nICsgZ2V0X3BhcmFtcy5qb2luKCcmJykgOiAnJyk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBQYXRoTWFrZXIgPSAoZnVuY3Rpb24gKCkge1xuICAgICAgICBmdW5jdGlvbiBQYXRoTWFrZXIoKSB7XG4gICAgICAgICAgICB0aGlzLnBhdGhzID0gW107XG4gICAgICAgICAgICB0aGlzLmluY2x1ZGVzID0gW107XG4gICAgICAgIH1cbiAgICAgICAgUGF0aE1ha2VyLnByb3RvdHlwZS5hZGRQYXRoID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLnBhdGhzLnB1c2godmFsdWUpO1xuICAgICAgICB9O1xuICAgICAgICBQYXRoTWFrZXIucHJvdG90eXBlLnNldEluY2x1ZGUgPSBmdW5jdGlvbiAoc3RyaW5nc19hcnJheSkge1xuICAgICAgICAgICAgdGhpcy5pbmNsdWRlcyA9IHN0cmluZ3NfYXJyYXk7XG4gICAgICAgIH07XG4gICAgICAgIFBhdGhNYWtlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGdldF9wYXJhbXMgPSBbXTtcbiAgICAgICAgICAgIGlmICh0aGlzLmluY2x1ZGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBnZXRfcGFyYW1zLnB1c2goJ2luY2x1ZGU9JyArIHRoaXMuaW5jbHVkZXMuam9pbignLCcpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnBhdGhzLmpvaW4oJy8nKSArXG4gICAgICAgICAgICAgICAgKGdldF9wYXJhbXMubGVuZ3RoID4gMCA/ICc/JyArIGdldF9wYXJhbXMuam9pbignJicpIDogJycpO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gUGF0aE1ha2VyO1xuICAgIH0oKSk7XG4gICAgSnNvbmFwaS5QYXRoTWFrZXIgPSBQYXRoTWFrZXI7XG59KShKc29uYXBpIHx8IChKc29uYXBpID0ge30pKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgQ29udmVydGVyIHtcblxuICAgICAgICAvKipcbiAgICAgICAgQ29udmVydCBqc29uIGFycmF5cyAobGlrZSBpbmNsdWRlZCkgdG8gYW4gUmVzb3VyY2VzIGFycmF5cyB3aXRob3V0IFtrZXlzXVxuICAgICAgICAqKi9cbiAgICAgICAgc3RhdGljIGpzb25fYXJyYXkycmVzb3VyY2VzX2FycmF5KFxuICAgICAgICAgICAganNvbl9hcnJheTogQXJyYXk8SnNvbmFwaS5JRGF0YVJlc291cmNlPixcbiAgICAgICAgICAgIGRlc3RpbmF0aW9uX2FycmF5PzogT2JqZWN0LCAvLyBBcnJheTxKc29uYXBpLklSZXNvdXJjZT4sXG4gICAgICAgICAgICB1c2VfaWRfZm9yX2tleSA9IGZhbHNlXG4gICAgICAgICk6IE9iamVjdCB7IC8vIEFycmF5PEpzb25hcGkuSVJlc291cmNlPiB7XG4gICAgICAgICAgICBpZiAoIWRlc3RpbmF0aW9uX2FycmF5KSB7XG4gICAgICAgICAgICAgICAgZGVzdGluYXRpb25fYXJyYXkgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGxldCBjb3VudCA9IDA7XG4gICAgICAgICAgICBmb3IgKGxldCBkYXRhIG9mIGpzb25fYXJyYXkpIHtcbiAgICAgICAgICAgICAgICBsZXQgcmVzb3VyY2UgPSBKc29uYXBpLkNvbnZlcnRlci5qc29uMnJlc291cmNlKGRhdGEsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBpZiAodXNlX2lkX2Zvcl9rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVzdGluYXRpb25fYXJyYXlbcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gaW5jbHVkZWQgZm9yIGV4YW1wbGUgbmVlZCBhIGV4dHJhIHBhcmFtZXRlclxuICAgICAgICAgICAgICAgICAgICBkZXN0aW5hdGlvbl9hcnJheVtyZXNvdXJjZS50eXBlICsgJ18nICsgcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgICAgIC8vIGRlc3RpbmF0aW9uX2FycmF5LnB1c2gocmVzb3VyY2UuaWQgKyByZXNvdXJjZS50eXBlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY291bnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGRlc3RpbmF0aW9uX2FycmF5WyckY291bnQnXSA9IGNvdW50OyAvLyBwcm9ibGVtIHdpdGggdG9BcnJheSBvciBhbmd1bGFyLmZvckVhY2ggbmVlZCBhICFpc09iamVjdFxuICAgICAgICAgICAgcmV0dXJuIGRlc3RpbmF0aW9uX2FycmF5O1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgIENvbnZlcnQganNvbiBhcnJheXMgKGxpa2UgaW5jbHVkZWQpIHRvIGFuIGluZGV4ZWQgUmVzb3VyY2VzIGFycmF5IGJ5IFt0eXBlXVtpZF1cbiAgICAgICAgKiovXG4gICAgICAgIHN0YXRpYyBqc29uX2FycmF5MnJlc291cmNlc19hcnJheV9ieV90eXBlIChcbiAgICAgICAgICAgIGpzb25fYXJyYXk6IEFycmF5PEpzb25hcGkuSURhdGFSZXNvdXJjZT4sXG4gICAgICAgICAgICBpbnN0YW5jZV9yZWxhdGlvbnNoaXBzOiBib29sZWFuXG4gICAgICAgICk6IE9iamVjdCB7IC8vIEFycmF5PEpzb25hcGkuSVJlc291cmNlPiB7XG4gICAgICAgICAgICBsZXQgYWxsX3Jlc291cmNlczphbnkgPSB7IH0gO1xuICAgICAgICAgICAgQ29udmVydGVyLmpzb25fYXJyYXkycmVzb3VyY2VzX2FycmF5KGpzb25fYXJyYXksIGFsbF9yZXNvdXJjZXMsIGZhbHNlKTtcbiAgICAgICAgICAgIGxldCByZXNvdXJjZXMgPSB7IH07XG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2goYWxsX3Jlc291cmNlcywgKHJlc291cmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCEocmVzb3VyY2UudHlwZSBpbiByZXNvdXJjZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc291cmNlc1tyZXNvdXJjZS50eXBlXSA9IHsgfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzW3Jlc291cmNlLnR5cGVdW3Jlc291cmNlLmlkXSA9IHJlc291cmNlO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gcmVzb3VyY2VzO1xuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGljIGpzb24ycmVzb3VyY2UoanNvbl9yZXNvdXJjZTogSnNvbmFwaS5JRGF0YVJlc291cmNlLCBpbnN0YW5jZV9yZWxhdGlvbnNoaXBzKTogSnNvbmFwaS5JUmVzb3VyY2Uge1xuICAgICAgICAgICAgbGV0IHJlc291cmNlX3NlcnZpY2UgPSBKc29uYXBpLkNvbnZlcnRlci5nZXRTZXJ2aWNlKGpzb25fcmVzb3VyY2UudHlwZSk7XG4gICAgICAgICAgICBpZiAocmVzb3VyY2Vfc2VydmljZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBKc29uYXBpLkNvbnZlcnRlci5wcm9jcmVhdGUocmVzb3VyY2Vfc2VydmljZSwganNvbl9yZXNvdXJjZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIHNlcnZpY2Ugbm90IHJlZ2lzdGVyZWRcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ2AnICsganNvbl9yZXNvdXJjZS50eXBlICsgJ2AnLCAnc2VydmljZSBub3QgZm91bmQgb24ganNvbjJyZXNvdXJjZSgpJyk7XG4gICAgICAgICAgICAgICAgbGV0IHRlbXAgPSBuZXcgSnNvbmFwaS5SZXNvdXJjZSgpO1xuICAgICAgICAgICAgICAgIHRlbXAuaWQgPSBqc29uX3Jlc291cmNlLmlkO1xuICAgICAgICAgICAgICAgIHRlbXAudHlwZSA9IGpzb25fcmVzb3VyY2UudHlwZTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGVtcDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRpYyBnZXRTZXJ2aWNlKHR5cGU6IHN0cmluZyk6IEpzb25hcGkuSVJlc291cmNlIHtcbiAgICAgICAgICAgIGxldCByZXNvdXJjZV9zZXJ2aWNlID0gSnNvbmFwaS5Db3JlLk1lLmdldFJlc291cmNlKHR5cGUpO1xuICAgICAgICAgICAgaWYgKGFuZ3VsYXIuaXNVbmRlZmluZWQocmVzb3VyY2Vfc2VydmljZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ2AnICsgdHlwZSArICdgJywgJ3NlcnZpY2Ugbm90IGZvdW5kIG9uIGdldFNlcnZpY2UoKScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlc291cmNlX3NlcnZpY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvKiByZXR1cm4gYSByZXNvdXJjZSB0eXBlKHJlc29ydWNlX3NlcnZpY2UpIHdpdGggZGF0YShkYXRhKSAqL1xuICAgICAgICBzdGF0aWMgcHJvY3JlYXRlKHJlc291cmNlX3NlcnZpY2U6IEpzb25hcGkuSVJlc291cmNlLCBkYXRhOiBKc29uYXBpLklEYXRhUmVzb3VyY2UpOiBKc29uYXBpLklSZXNvdXJjZSB7XG4gICAgICAgICAgICBpZiAoISgndHlwZScgaW4gZGF0YSAmJiAnaWQnIGluIGRhdGEpKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignSnNvbmFwaSBSZXNvdXJjZSBpcyBub3QgY29ycmVjdCcsIGRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbGV0IHJlc291cmNlID0gbmV3ICg8YW55PnJlc291cmNlX3NlcnZpY2UuY29uc3RydWN0b3IpKCk7XG4gICAgICAgICAgICByZXNvdXJjZS5uZXcoKTtcbiAgICAgICAgICAgIHJlc291cmNlLmlkID0gZGF0YS5pZDtcbiAgICAgICAgICAgIHJlc291cmNlLmF0dHJpYnV0ZXMgPSBkYXRhLmF0dHJpYnV0ZXMgPyBkYXRhLmF0dHJpYnV0ZXMgOiB7fTtcbiAgICAgICAgICAgIHJlc291cmNlLmlzX25ldyA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuIHJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGljIGJ1aWxkKGRvY3VtZW50X2Zyb206IGFueSwgcmVzb3VyY2VfZGVzdDogYW55LCBzY2hlbWE6IElTY2hlbWEpIHtcbiAgICAgICAgICAgIC8vIGluc3RhbmNpbyBsb3MgaW5jbHVkZSB5IGxvcyBndWFyZG8gZW4gaW5jbHVkZWQgYXJyYXJ5XG4gICAgICAgICAgICBsZXQgaW5jbHVkZWQgPSB7fTtcbiAgICAgICAgICAgIGlmICgnaW5jbHVkZWQnIGluIGRvY3VtZW50X2Zyb20pIHtcbiAgICAgICAgICAgICAgICBpbmNsdWRlZCA9IENvbnZlcnRlci5qc29uX2FycmF5MnJlc291cmNlc19hcnJheV9ieV90eXBlKGRvY3VtZW50X2Zyb20uaW5jbHVkZWQsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGFuZ3VsYXIuaXNBcnJheShkb2N1bWVudF9mcm9tLmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgQ29udmVydGVyLl9idWlsZFJlc291cmNlcyhkb2N1bWVudF9mcm9tLCByZXNvdXJjZV9kZXN0LCBzY2hlbWEsIGluY2x1ZGVkKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgQ29udmVydGVyLl9idWlsZFJlc291cmNlKGRvY3VtZW50X2Zyb20uZGF0YSwgcmVzb3VyY2VfZGVzdCwgc2NoZW1hLCBpbmNsdWRlZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBzdGF0aWMgX2J1aWxkUmVzb3VyY2VzKGRvY3VtZW50X2Zyb206IElEYXRhQ29sbGVjdGlvbiwgcmVzb3VyY2VfZGVzdDogQXJyYXk8SURhdGFDb2xsZWN0aW9uPiwgc2NoZW1hOiBJU2NoZW1hLCBpbmNsdWRlZCkge1xuICAgICAgICAgICAgZm9yIChsZXQgZGF0YSBvZiBkb2N1bWVudF9mcm9tLmRhdGEpIHtcbiAgICAgICAgICAgICAgICBsZXQgcmVzb3VyY2UgPSBKc29uYXBpLkNvbnZlcnRlci5nZXRTZXJ2aWNlKGRhdGEudHlwZSk7XG4gICAgICAgICAgICAgICAgaWYgKCEoZGF0YS5pZCBpbiByZXNvdXJjZV9kZXN0KSkge1xuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZV9kZXN0W2RhdGEuaWRdID0gbmV3ICg8YW55PnJlc291cmNlLmNvbnN0cnVjdG9yKSgpO1xuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZV9kZXN0W2RhdGEuaWRdLnJlc2V0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIENvbnZlcnRlci5fYnVpbGRSZXNvdXJjZShkYXRhLCByZXNvdXJjZV9kZXN0W2RhdGEuaWRdLCBzY2hlbWEsIGluY2x1ZGVkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRpYyBfYnVpbGRSZXNvdXJjZShkb2N1bWVudF9mcm9tOiBJRGF0YVJlc291cmNlLCByZXNvdXJjZV9kZXN0OiBJUmVzb3VyY2UsIHNjaGVtYTogSVNjaGVtYSwgaW5jbHVkZWQpIHtcbiAgICAgICAgICAgIHJlc291cmNlX2Rlc3QuYXR0cmlidXRlcyA9IGRvY3VtZW50X2Zyb20uYXR0cmlidXRlcztcbiAgICAgICAgICAgIHJlc291cmNlX2Rlc3QuaWQgPSBkb2N1bWVudF9mcm9tLmlkO1xuICAgICAgICAgICAgcmVzb3VyY2VfZGVzdC5pc19uZXcgPSBmYWxzZTtcbiAgICAgICAgICAgIENvbnZlcnRlci5fX2J1aWxkUmVsYXRpb25zaGlwcyhkb2N1bWVudF9mcm9tLnJlbGF0aW9uc2hpcHMsIHJlc291cmNlX2Rlc3QucmVsYXRpb25zaGlwcywgaW5jbHVkZWQsIHNjaGVtYSk7XG4gICAgICAgIH1cblxuICAgICAgICBzdGF0aWMgX19idWlsZFJlbGF0aW9uc2hpcHMocmVsYXRpb25zaGlwc19mcm9tOiBBcnJheTxhbnk+LCByZWxhdGlvbnNoaXBzX2Rlc3Q6IEFycmF5PGFueT4sIGluY2x1ZGVkX2FycmF5LCBzY2hlbWE6IElTY2hlbWEpIHtcbiAgICAgICAgICAgIC8vIHJlY29ycm8gbG9zIHJlbGF0aW9uc2hpcHMgbGV2YW50byBlbCBzZXJ2aWNlIGNvcnJlc3BvbmRpZW50ZVxuICAgICAgICAgICAgYW5ndWxhci5mb3JFYWNoKHJlbGF0aW9uc2hpcHNfZnJvbSwgKHJlbGF0aW9uX3ZhbHVlLCByZWxhdGlvbl9rZXkpID0+IHtcblxuICAgICAgICAgICAgICAgIC8vIHJlbGF0aW9uIGlzIGluIHNjaGVtYT8gaGF2ZSBkYXRhIG9yIGp1c3QgbGlua3M/XG4gICAgICAgICAgICAgICAgaWYgKCEocmVsYXRpb25fa2V5IGluIHJlbGF0aW9uc2hpcHNfZGVzdCkgJiYgKCdkYXRhJyBpbiByZWxhdGlvbl92YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0gPSB7IGRhdGE6IFtdIH07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy8gc29tZXRpbWUgZGF0YT1udWxsIG9yIHNpbXBsZSB7IH1cbiAgICAgICAgICAgICAgICBpZiAoIXJlbGF0aW9uX3ZhbHVlLmRhdGEpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiA7XG5cbiAgICAgICAgICAgICAgICBpZiAoc2NoZW1hLnJlbGF0aW9uc2hpcHNbcmVsYXRpb25fa2V5XSAmJiBzY2hlbWEucmVsYXRpb25zaGlwc1tyZWxhdGlvbl9rZXldLmhhc01hbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHJlbGF0aW9uX3ZhbHVlLmRhdGEubGVuZ3RoIDwgMSlcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiA7XG4gICAgICAgICAgICAgICAgICAgIGxldCByZXNvdXJjZV9zZXJ2aWNlID0gSnNvbmFwaS5Db252ZXJ0ZXIuZ2V0U2VydmljZShyZWxhdGlvbl92YWx1ZS5kYXRhWzBdLnR5cGUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocmVzb3VyY2Vfc2VydmljZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0uZGF0YSA9IHt9OyAvLyBmb3JjZSB0byBvYmplY3QgKG5vdCBhcnJheSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuZ3VsYXIuZm9yRWFjaChyZWxhdGlvbl92YWx1ZS5kYXRhLCAocmVsYXRpb25fdmFsdWU6IEpzb25hcGkuSURhdGFSZXNvdXJjZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCB0bXAgPSBDb252ZXJ0ZXIuX19idWlsZFJlbGF0aW9uc2hpcChyZWxhdGlvbl92YWx1ZSwgaW5jbHVkZWRfYXJyYXkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uc2hpcHNfZGVzdFtyZWxhdGlvbl9rZXldLmRhdGFbdG1wLmlkXSA9IHRtcDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0uZGF0YSA9IENvbnZlcnRlci5fX2J1aWxkUmVsYXRpb25zaGlwKHJlbGF0aW9uX3ZhbHVlLmRhdGEsIGluY2x1ZGVkX2FycmF5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRpYyBfX2J1aWxkUmVsYXRpb25zaGlwKHJlbGF0aW9uOiBKc29uYXBpLklEYXRhUmVzb3VyY2UsIGluY2x1ZGVkX2FycmF5KTogSnNvbmFwaS5JUmVzb3VyY2UgfCBKc29uYXBpLklEYXRhUmVzb3VyY2Uge1xuICAgICAgICAgICAgaWYgKHJlbGF0aW9uLnR5cGUgaW4gaW5jbHVkZWRfYXJyYXkgJiZcbiAgICAgICAgICAgICAgICByZWxhdGlvbi5pZCBpbiBpbmNsdWRlZF9hcnJheVtyZWxhdGlvbi50eXBlXVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgLy8gaXQncyBpbiBpbmNsdWRlZFxuICAgICAgICAgICAgICAgIHJldHVybiBpbmNsdWRlZF9hcnJheVtyZWxhdGlvbi50eXBlXVtyZWxhdGlvbi5pZF07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIHJlc291cmNlIG5vdCBpbmNsdWRlZCwgcmV0dXJuIGRpcmVjdGx5IHRoZSBvYmplY3RcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVsYXRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuXG5cblxuXG4gICAgfVxufVxuIiwidmFyIEpzb25hcGk7XG4oZnVuY3Rpb24gKEpzb25hcGkpIHtcbiAgICB2YXIgQ29udmVydGVyID0gKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgZnVuY3Rpb24gQ29udmVydGVyKCkge1xuICAgICAgICB9XG4gICAgICAgIC8qKlxuICAgICAgICBDb252ZXJ0IGpzb24gYXJyYXlzIChsaWtlIGluY2x1ZGVkKSB0byBhbiBSZXNvdXJjZXMgYXJyYXlzIHdpdGhvdXQgW2tleXNdXG4gICAgICAgICoqL1xuICAgICAgICBDb252ZXJ0ZXIuanNvbl9hcnJheTJyZXNvdXJjZXNfYXJyYXkgPSBmdW5jdGlvbiAoanNvbl9hcnJheSwgZGVzdGluYXRpb25fYXJyYXksIC8vIEFycmF5PEpzb25hcGkuSVJlc291cmNlPixcbiAgICAgICAgICAgIHVzZV9pZF9mb3Jfa2V5KSB7XG4gICAgICAgICAgICBpZiAodXNlX2lkX2Zvcl9rZXkgPT09IHZvaWQgMCkgeyB1c2VfaWRfZm9yX2tleSA9IGZhbHNlOyB9XG4gICAgICAgICAgICBpZiAoIWRlc3RpbmF0aW9uX2FycmF5KSB7XG4gICAgICAgICAgICAgICAgZGVzdGluYXRpb25fYXJyYXkgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBjb3VudCA9IDA7XG4gICAgICAgICAgICBmb3IgKHZhciBfaSA9IDAsIGpzb25fYXJyYXlfMSA9IGpzb25fYXJyYXk7IF9pIDwganNvbl9hcnJheV8xLmxlbmd0aDsgX2krKykge1xuICAgICAgICAgICAgICAgIHZhciBkYXRhID0ganNvbl9hcnJheV8xW19pXTtcbiAgICAgICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSBKc29uYXBpLkNvbnZlcnRlci5qc29uMnJlc291cmNlKGRhdGEsIGZhbHNlKTtcbiAgICAgICAgICAgICAgICBpZiAodXNlX2lkX2Zvcl9rZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgZGVzdGluYXRpb25fYXJyYXlbcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBpbmNsdWRlZCBmb3IgZXhhbXBsZSBuZWVkIGEgZXh0cmEgcGFyYW1ldGVyXG4gICAgICAgICAgICAgICAgICAgIGRlc3RpbmF0aW9uX2FycmF5W3Jlc291cmNlLnR5cGUgKyAnXycgKyByZXNvdXJjZS5pZF0gPSByZXNvdXJjZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY291bnQrKztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGRlc3RpbmF0aW9uX2FycmF5WyckY291bnQnXSA9IGNvdW50OyAvLyBwcm9ibGVtIHdpdGggdG9BcnJheSBvciBhbmd1bGFyLmZvckVhY2ggbmVlZCBhICFpc09iamVjdFxuICAgICAgICAgICAgcmV0dXJuIGRlc3RpbmF0aW9uX2FycmF5O1xuICAgICAgICB9O1xuICAgICAgICAvKipcbiAgICAgICAgQ29udmVydCBqc29uIGFycmF5cyAobGlrZSBpbmNsdWRlZCkgdG8gYW4gaW5kZXhlZCBSZXNvdXJjZXMgYXJyYXkgYnkgW3R5cGVdW2lkXVxuICAgICAgICAqKi9cbiAgICAgICAgQ29udmVydGVyLmpzb25fYXJyYXkycmVzb3VyY2VzX2FycmF5X2J5X3R5cGUgPSBmdW5jdGlvbiAoanNvbl9hcnJheSwgaW5zdGFuY2VfcmVsYXRpb25zaGlwcykge1xuICAgICAgICAgICAgdmFyIGFsbF9yZXNvdXJjZXMgPSB7fTtcbiAgICAgICAgICAgIENvbnZlcnRlci5qc29uX2FycmF5MnJlc291cmNlc19hcnJheShqc29uX2FycmF5LCBhbGxfcmVzb3VyY2VzLCBmYWxzZSk7XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2VzID0ge307XG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2goYWxsX3Jlc291cmNlcywgZnVuY3Rpb24gKHJlc291cmNlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCEocmVzb3VyY2UudHlwZSBpbiByZXNvdXJjZXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc291cmNlc1tyZXNvdXJjZS50eXBlXSA9IHt9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXNvdXJjZXNbcmVzb3VyY2UudHlwZV1bcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiByZXNvdXJjZXM7XG4gICAgICAgIH07XG4gICAgICAgIENvbnZlcnRlci5qc29uMnJlc291cmNlID0gZnVuY3Rpb24gKGpzb25fcmVzb3VyY2UsIGluc3RhbmNlX3JlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgICAgIHZhciByZXNvdXJjZV9zZXJ2aWNlID0gSnNvbmFwaS5Db252ZXJ0ZXIuZ2V0U2VydmljZShqc29uX3Jlc291cmNlLnR5cGUpO1xuICAgICAgICAgICAgaWYgKHJlc291cmNlX3NlcnZpY2UpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gSnNvbmFwaS5Db252ZXJ0ZXIucHJvY3JlYXRlKHJlc291cmNlX3NlcnZpY2UsIGpzb25fcmVzb3VyY2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gc2VydmljZSBub3QgcmVnaXN0ZXJlZFxuICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignYCcgKyBqc29uX3Jlc291cmNlLnR5cGUgKyAnYCcsICdzZXJ2aWNlIG5vdCBmb3VuZCBvbiBqc29uMnJlc291cmNlKCknKTtcbiAgICAgICAgICAgICAgICB2YXIgdGVtcCA9IG5ldyBKc29uYXBpLlJlc291cmNlKCk7XG4gICAgICAgICAgICAgICAgdGVtcC5pZCA9IGpzb25fcmVzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgdGVtcC50eXBlID0ganNvbl9yZXNvdXJjZS50eXBlO1xuICAgICAgICAgICAgICAgIHJldHVybiB0ZW1wO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBDb252ZXJ0ZXIuZ2V0U2VydmljZSA9IGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2Vfc2VydmljZSA9IEpzb25hcGkuQ29yZS5NZS5nZXRSZXNvdXJjZSh0eXBlKTtcbiAgICAgICAgICAgIGlmIChhbmd1bGFyLmlzVW5kZWZpbmVkKHJlc291cmNlX3NlcnZpY2UpKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdgJyArIHR5cGUgKyAnYCcsICdzZXJ2aWNlIG5vdCBmb3VuZCBvbiBnZXRTZXJ2aWNlKCknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZXNvdXJjZV9zZXJ2aWNlO1xuICAgICAgICB9O1xuICAgICAgICAvKiByZXR1cm4gYSByZXNvdXJjZSB0eXBlKHJlc29ydWNlX3NlcnZpY2UpIHdpdGggZGF0YShkYXRhKSAqL1xuICAgICAgICBDb252ZXJ0ZXIucHJvY3JlYXRlID0gZnVuY3Rpb24gKHJlc291cmNlX3NlcnZpY2UsIGRhdGEpIHtcbiAgICAgICAgICAgIGlmICghKCd0eXBlJyBpbiBkYXRhICYmICdpZCcgaW4gZGF0YSkpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdKc29uYXBpIFJlc291cmNlIGlzIG5vdCBjb3JyZWN0JywgZGF0YSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSBuZXcgcmVzb3VyY2Vfc2VydmljZS5jb25zdHJ1Y3RvcigpO1xuICAgICAgICAgICAgcmVzb3VyY2UubmV3KCk7XG4gICAgICAgICAgICByZXNvdXJjZS5pZCA9IGRhdGEuaWQ7XG4gICAgICAgICAgICByZXNvdXJjZS5hdHRyaWJ1dGVzID0gZGF0YS5hdHRyaWJ1dGVzID8gZGF0YS5hdHRyaWJ1dGVzIDoge307XG4gICAgICAgICAgICByZXNvdXJjZS5pc19uZXcgPSBmYWxzZTtcbiAgICAgICAgICAgIHJldHVybiByZXNvdXJjZTtcbiAgICAgICAgfTtcbiAgICAgICAgQ29udmVydGVyLmJ1aWxkID0gZnVuY3Rpb24gKGRvY3VtZW50X2Zyb20sIHJlc291cmNlX2Rlc3QsIHNjaGVtYSkge1xuICAgICAgICAgICAgLy8gaW5zdGFuY2lvIGxvcyBpbmNsdWRlIHkgbG9zIGd1YXJkbyBlbiBpbmNsdWRlZCBhcnJhcnlcbiAgICAgICAgICAgIHZhciBpbmNsdWRlZCA9IHt9O1xuICAgICAgICAgICAgaWYgKCdpbmNsdWRlZCcgaW4gZG9jdW1lbnRfZnJvbSkge1xuICAgICAgICAgICAgICAgIGluY2x1ZGVkID0gQ29udmVydGVyLmpzb25fYXJyYXkycmVzb3VyY2VzX2FycmF5X2J5X3R5cGUoZG9jdW1lbnRfZnJvbS5pbmNsdWRlZCwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGFuZ3VsYXIuaXNBcnJheShkb2N1bWVudF9mcm9tLmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgQ29udmVydGVyLl9idWlsZFJlc291cmNlcyhkb2N1bWVudF9mcm9tLCByZXNvdXJjZV9kZXN0LCBzY2hlbWEsIGluY2x1ZGVkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIENvbnZlcnRlci5fYnVpbGRSZXNvdXJjZShkb2N1bWVudF9mcm9tLmRhdGEsIHJlc291cmNlX2Rlc3QsIHNjaGVtYSwgaW5jbHVkZWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBDb252ZXJ0ZXIuX2J1aWxkUmVzb3VyY2VzID0gZnVuY3Rpb24gKGRvY3VtZW50X2Zyb20sIHJlc291cmNlX2Rlc3QsIHNjaGVtYSwgaW5jbHVkZWQpIHtcbiAgICAgICAgICAgIGZvciAodmFyIF9pID0gMCwgX2EgPSBkb2N1bWVudF9mcm9tLmRhdGE7IF9pIDwgX2EubGVuZ3RoOyBfaSsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRhdGEgPSBfYVtfaV07XG4gICAgICAgICAgICAgICAgdmFyIHJlc291cmNlID0gSnNvbmFwaS5Db252ZXJ0ZXIuZ2V0U2VydmljZShkYXRhLnR5cGUpO1xuICAgICAgICAgICAgICAgIGlmICghKGRhdGEuaWQgaW4gcmVzb3VyY2VfZGVzdCkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2VfZGVzdFtkYXRhLmlkXSA9IG5ldyByZXNvdXJjZS5jb25zdHJ1Y3RvcigpO1xuICAgICAgICAgICAgICAgICAgICByZXNvdXJjZV9kZXN0W2RhdGEuaWRdLnJlc2V0KCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIENvbnZlcnRlci5fYnVpbGRSZXNvdXJjZShkYXRhLCByZXNvdXJjZV9kZXN0W2RhdGEuaWRdLCBzY2hlbWEsIGluY2x1ZGVkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgQ29udmVydGVyLl9idWlsZFJlc291cmNlID0gZnVuY3Rpb24gKGRvY3VtZW50X2Zyb20sIHJlc291cmNlX2Rlc3QsIHNjaGVtYSwgaW5jbHVkZWQpIHtcbiAgICAgICAgICAgIHJlc291cmNlX2Rlc3QuYXR0cmlidXRlcyA9IGRvY3VtZW50X2Zyb20uYXR0cmlidXRlcztcbiAgICAgICAgICAgIHJlc291cmNlX2Rlc3QuaWQgPSBkb2N1bWVudF9mcm9tLmlkO1xuICAgICAgICAgICAgcmVzb3VyY2VfZGVzdC5pc19uZXcgPSBmYWxzZTtcbiAgICAgICAgICAgIENvbnZlcnRlci5fX2J1aWxkUmVsYXRpb25zaGlwcyhkb2N1bWVudF9mcm9tLnJlbGF0aW9uc2hpcHMsIHJlc291cmNlX2Rlc3QucmVsYXRpb25zaGlwcywgaW5jbHVkZWQsIHNjaGVtYSk7XG4gICAgICAgIH07XG4gICAgICAgIENvbnZlcnRlci5fX2J1aWxkUmVsYXRpb25zaGlwcyA9IGZ1bmN0aW9uIChyZWxhdGlvbnNoaXBzX2Zyb20sIHJlbGF0aW9uc2hpcHNfZGVzdCwgaW5jbHVkZWRfYXJyYXksIHNjaGVtYSkge1xuICAgICAgICAgICAgLy8gcmVjb3JybyBsb3MgcmVsYXRpb25zaGlwcyBsZXZhbnRvIGVsIHNlcnZpY2UgY29ycmVzcG9uZGllbnRlXG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2gocmVsYXRpb25zaGlwc19mcm9tLCBmdW5jdGlvbiAocmVsYXRpb25fdmFsdWUsIHJlbGF0aW9uX2tleSkge1xuICAgICAgICAgICAgICAgIC8vIHJlbGF0aW9uIGlzIGluIHNjaGVtYT8gaGF2ZSBkYXRhIG9yIGp1c3QgbGlua3M/XG4gICAgICAgICAgICAgICAgaWYgKCEocmVsYXRpb25fa2V5IGluIHJlbGF0aW9uc2hpcHNfZGVzdCkgJiYgKCdkYXRhJyBpbiByZWxhdGlvbl92YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0gPSB7IGRhdGE6IFtdIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIHNvbWV0aW1lIGRhdGE9bnVsbCBvciBzaW1wbGUgeyB9XG4gICAgICAgICAgICAgICAgaWYgKCFyZWxhdGlvbl92YWx1ZS5kYXRhKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgaWYgKHNjaGVtYS5yZWxhdGlvbnNoaXBzW3JlbGF0aW9uX2tleV0gJiYgc2NoZW1hLnJlbGF0aW9uc2hpcHNbcmVsYXRpb25fa2V5XS5oYXNNYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyZWxhdGlvbl92YWx1ZS5kYXRhLmxlbmd0aCA8IDEpXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIHZhciByZXNvdXJjZV9zZXJ2aWNlID0gSnNvbmFwaS5Db252ZXJ0ZXIuZ2V0U2VydmljZShyZWxhdGlvbl92YWx1ZS5kYXRhWzBdLnR5cGUpO1xuICAgICAgICAgICAgICAgICAgICBpZiAocmVzb3VyY2Vfc2VydmljZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0uZGF0YSA9IHt9OyAvLyBmb3JjZSB0byBvYmplY3QgKG5vdCBhcnJheSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGFuZ3VsYXIuZm9yRWFjaChyZWxhdGlvbl92YWx1ZS5kYXRhLCBmdW5jdGlvbiAocmVsYXRpb25fdmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgdG1wID0gQ29udmVydGVyLl9fYnVpbGRSZWxhdGlvbnNoaXAocmVsYXRpb25fdmFsdWUsIGluY2x1ZGVkX2FycmF5KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnNoaXBzX2Rlc3RbcmVsYXRpb25fa2V5XS5kYXRhW3RtcC5pZF0gPSB0bXA7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc19kZXN0W3JlbGF0aW9uX2tleV0uZGF0YSA9IENvbnZlcnRlci5fX2J1aWxkUmVsYXRpb25zaGlwKHJlbGF0aW9uX3ZhbHVlLmRhdGEsIGluY2x1ZGVkX2FycmF5KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICAgICAgQ29udmVydGVyLl9fYnVpbGRSZWxhdGlvbnNoaXAgPSBmdW5jdGlvbiAocmVsYXRpb24sIGluY2x1ZGVkX2FycmF5KSB7XG4gICAgICAgICAgICBpZiAocmVsYXRpb24udHlwZSBpbiBpbmNsdWRlZF9hcnJheSAmJlxuICAgICAgICAgICAgICAgIHJlbGF0aW9uLmlkIGluIGluY2x1ZGVkX2FycmF5W3JlbGF0aW9uLnR5cGVdKSB7XG4gICAgICAgICAgICAgICAgLy8gaXQncyBpbiBpbmNsdWRlZFxuICAgICAgICAgICAgICAgIHJldHVybiBpbmNsdWRlZF9hcnJheVtyZWxhdGlvbi50eXBlXVtyZWxhdGlvbi5pZF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyByZXNvdXJjZSBub3QgaW5jbHVkZWQsIHJldHVybiBkaXJlY3RseSB0aGUgb2JqZWN0XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlbGF0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gQ29udmVydGVyO1xuICAgIH0oKSk7XG4gICAgSnNvbmFwaS5Db252ZXJ0ZXIgPSBDb252ZXJ0ZXI7XG59KShKc29uYXBpIHx8IChKc29uYXBpID0ge30pKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgQ29yZSBpbXBsZW1lbnRzIEpzb25hcGkuSUNvcmUge1xuICAgICAgICBwdWJsaWMgcm9vdFBhdGg6IHN0cmluZyA9ICdodHRwOi8vcmV5ZXNvZnQuZGRucy5uZXQ6OTk5OS9hcGkvdjEvY29tcGFuaWVzLzInO1xuICAgICAgICBwdWJsaWMgcmVzb3VyY2VzOiBBcnJheTxKc29uYXBpLklSZXNvdXJjZT4gPSBbXTtcblxuICAgICAgICBwdWJsaWMgbG9hZGluZ3NDb3VudGVyOiBudW1iZXIgPSAwO1xuICAgICAgICBwdWJsaWMgbG9hZGluZ3NTdGFydCA9ICgpID0+IHt9O1xuICAgICAgICBwdWJsaWMgbG9hZGluZ3NEb25lID0gKCkgPT4ge307XG4gICAgICAgIHB1YmxpYyBsb2FkaW5nc0Vycm9yID0gKCkgPT4ge307XG5cbiAgICAgICAgcHVibGljIHN0YXRpYyBNZTogSnNvbmFwaS5JQ29yZSA9IG51bGw7XG4gICAgICAgIHB1YmxpYyBzdGF0aWMgU2VydmljZXM6IGFueSA9IG51bGw7XG5cbiAgICAgICAgLyoqIEBuZ0luamVjdCAqL1xuICAgICAgICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgICAgICAgICBwcm90ZWN0ZWQgcnNKc29uYXBpQ29uZmlnLFxuICAgICAgICAgICAgcHJvdGVjdGVkIEpzb25hcGlDb3JlU2VydmljZXNcbiAgICAgICAgKSB7XG4gICAgICAgICAgICBKc29uYXBpLkNvcmUuTWUgPSB0aGlzO1xuICAgICAgICAgICAgSnNvbmFwaS5Db3JlLlNlcnZpY2VzID0gSnNvbmFwaUNvcmVTZXJ2aWNlcztcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBfcmVnaXN0ZXIoY2xhc2UpOiBib29sZWFuIHtcbiAgICAgICAgICAgIGlmIChjbGFzZS50eXBlIGluIHRoaXMucmVzb3VyY2VzKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5yZXNvdXJjZXNbY2xhc2UudHlwZV0gPSBjbGFzZTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcHVibGljIGdldFJlc291cmNlKHR5cGU6IHN0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb3VyY2VzW3R5cGVdO1xuICAgICAgICB9XG5cbiAgICAgICAgcHVibGljIHJlZnJlc2hMb2FkaW5ncyhmYWN0b3I6IG51bWJlcik6IHZvaWQge1xuICAgICAgICAgICAgdGhpcy5sb2FkaW5nc0NvdW50ZXIgKz0gZmFjdG9yO1xuICAgICAgICAgICAgaWYgKHRoaXMubG9hZGluZ3NDb3VudGVyID09PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2FkaW5nc0RvbmUoKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5sb2FkaW5nc0NvdW50ZXIgPT09IDEpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmdzU3RhcnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICBhbmd1bGFyLm1vZHVsZSgnSnNvbmFwaS5zZXJ2aWNlcycpLnNlcnZpY2UoJ0pzb25hcGlDb3JlJywgQ29yZSk7XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBDb3JlID0gKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLyoqIEBuZ0luamVjdCAqL1xuICAgICAgICBmdW5jdGlvbiBDb3JlKHJzSnNvbmFwaUNvbmZpZywgSnNvbmFwaUNvcmVTZXJ2aWNlcykge1xuICAgICAgICAgICAgdGhpcy5yc0pzb25hcGlDb25maWcgPSByc0pzb25hcGlDb25maWc7XG4gICAgICAgICAgICB0aGlzLkpzb25hcGlDb3JlU2VydmljZXMgPSBKc29uYXBpQ29yZVNlcnZpY2VzO1xuICAgICAgICAgICAgdGhpcy5yb290UGF0aCA9ICdodHRwOi8vcmV5ZXNvZnQuZGRucy5uZXQ6OTk5OS9hcGkvdjEvY29tcGFuaWVzLzInO1xuICAgICAgICAgICAgdGhpcy5yZXNvdXJjZXMgPSBbXTtcbiAgICAgICAgICAgIHRoaXMubG9hZGluZ3NDb3VudGVyID0gMDtcbiAgICAgICAgICAgIHRoaXMubG9hZGluZ3NTdGFydCA9IGZ1bmN0aW9uICgpIHsgfTtcbiAgICAgICAgICAgIHRoaXMubG9hZGluZ3NEb25lID0gZnVuY3Rpb24gKCkgeyB9O1xuICAgICAgICAgICAgdGhpcy5sb2FkaW5nc0Vycm9yID0gZnVuY3Rpb24gKCkgeyB9O1xuICAgICAgICAgICAgSnNvbmFwaS5Db3JlLk1lID0gdGhpcztcbiAgICAgICAgICAgIEpzb25hcGkuQ29yZS5TZXJ2aWNlcyA9IEpzb25hcGlDb3JlU2VydmljZXM7XG4gICAgICAgIH1cbiAgICAgICAgQ29yZS5wcm90b3R5cGUuX3JlZ2lzdGVyID0gZnVuY3Rpb24gKGNsYXNlKSB7XG4gICAgICAgICAgICBpZiAoY2xhc2UudHlwZSBpbiB0aGlzLnJlc291cmNlcykge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMucmVzb3VyY2VzW2NsYXNlLnR5cGVdID0gY2xhc2U7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfTtcbiAgICAgICAgQ29yZS5wcm90b3R5cGUuZ2V0UmVzb3VyY2UgPSBmdW5jdGlvbiAodHlwZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzb3VyY2VzW3R5cGVdO1xuICAgICAgICB9O1xuICAgICAgICBDb3JlLnByb3RvdHlwZS5yZWZyZXNoTG9hZGluZ3MgPSBmdW5jdGlvbiAoZmFjdG9yKSB7XG4gICAgICAgICAgICB0aGlzLmxvYWRpbmdzQ291bnRlciArPSBmYWN0b3I7XG4gICAgICAgICAgICBpZiAodGhpcy5sb2FkaW5nc0NvdW50ZXIgPT09IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmdzRG9uZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodGhpcy5sb2FkaW5nc0NvdW50ZXIgPT09IDEpIHtcbiAgICAgICAgICAgICAgICB0aGlzLmxvYWRpbmdzU3RhcnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgQ29yZS5NZSA9IG51bGw7XG4gICAgICAgIENvcmUuU2VydmljZXMgPSBudWxsO1xuICAgICAgICByZXR1cm4gQ29yZTtcbiAgICB9KCkpO1xuICAgIEpzb25hcGkuQ29yZSA9IENvcmU7XG4gICAgYW5ndWxhci5tb2R1bGUoJ0pzb25hcGkuc2VydmljZXMnKS5zZXJ2aWNlKCdKc29uYXBpQ29yZScsIENvcmUpO1xufSkoSnNvbmFwaSB8fCAoSnNvbmFwaSA9IHt9KSk7XG4iLCJtb2R1bGUgSnNvbmFwaSB7XG4gICAgZXhwb3J0IGNsYXNzIFJlc291cmNlIGltcGxlbWVudHMgSVJlc291cmNlIHtcbiAgICAgICAgcHVibGljIHNjaGVtYTogSVNjaGVtYTtcbiAgICAgICAgcHJvdGVjdGVkIHBhdGg6IHN0cmluZzsgICAvLyB3aXRob3V0IHNsYXNoZXNcblxuICAgICAgICBwdWJsaWMgaXNfbmV3ID0gdHJ1ZTtcbiAgICAgICAgcHVibGljIHR5cGU6IHN0cmluZztcbiAgICAgICAgcHVibGljIGlkOiBzdHJpbmc7XG4gICAgICAgIHB1YmxpYyBhdHRyaWJ1dGVzOiBhbnkgO1xuICAgICAgICBwdWJsaWMgcmVsYXRpb25zaGlwczogYW55ID0ge307IC8vW107XG4gICAgICAgIHB1YmxpYyBjYWNoZTogT2JqZWN0O1xuXG4gICAgICAgIHB1YmxpYyBjbG9uZSgpOiBhbnkge1xuICAgICAgICAgICAgdmFyIGNsb25lT2JqID0gbmV3ICg8YW55PnRoaXMuY29uc3RydWN0b3IpKCk7XG4gICAgICAgICAgICBmb3IgKHZhciBhdHRyaWJ1dCBpbiB0aGlzKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzW2F0dHJpYnV0XSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICAgICAgY2xvbmVPYmpbYXR0cmlidXRdID0gdGhpc1thdHRyaWJ1dF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNsb25lT2JqO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgIFJlZ2lzdGVyIHNjaGVtYSBvbiBKc29uYXBpLkNvcmVcbiAgICAgICAgQHJldHVybiB0cnVlIGlmIHRoZSByZXNvdXJjZSBkb24ndCBleGlzdCBhbmQgcmVnaXN0ZXJlZCBva1xuICAgICAgICAqKi9cbiAgICAgICAgcHVibGljIHJlZ2lzdGVyKCk6IGJvb2xlYW4ge1xuICAgICAgICAgICAgaWYgKEpzb25hcGkuQ29yZS5NZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHRocm93ICdFcnJvcjogeW91IGFyZSB0cnlpbmcgcmVnaXN0ZXIgLS0+ICcgKyB0aGlzLnR5cGUgKyAnIDwtLSBiZWZvcmUgaW5qZWN0IEpzb25hcGlDb3JlIHNvbWV3aGVyZSwgYWxtb3N0IG9uZSB0aW1lLic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBvbmx5IHdoZW4gc2VydmljZSBpcyByZWdpc3RlcmVkLCBub3QgY2xvbmVkIG9iamVjdFxuICAgICAgICAgICAgdGhpcy5jYWNoZSA9IHt9O1xuICAgICAgICAgICAgcmV0dXJuIEpzb25hcGkuQ29yZS5NZS5fcmVnaXN0ZXIodGhpcyk7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgZ2V0UGF0aCgpOiBzdHJpbmcge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucGF0aCA/IHRoaXMucGF0aCA6IHRoaXMudHlwZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGVtcHR5IHNlbGYgb2JqZWN0XG4gICAgICAgIHB1YmxpYyBuZXc8VCBleHRlbmRzIEpzb25hcGkuSVJlc291cmNlPigpOiBUIHtcbiAgICAgICAgICAgIGxldCByZXNvdXJjZSA9IHRoaXMuY2xvbmUoKTtcbiAgICAgICAgICAgIHJlc291cmNlLnJlc2V0KCk7XG4gICAgICAgICAgICByZXR1cm4gcmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgcmVzZXQoKTogdm9pZCB7XG4gICAgICAgICAgICBsZXQgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgICB0aGlzLmlkID0gJyc7XG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIHRoaXMucmVsYXRpb25zaGlwcyA9IHt9O1xuICAgICAgICAgICAgYW5ndWxhci5mb3JFYWNoKHRoaXMuc2NoZW1hLnJlbGF0aW9uc2hpcHMsICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgc2VsZi5yZWxhdGlvbnNoaXBzW2tleV0gPSB7fTtcbiAgICAgICAgICAgICAgICBzZWxmLnJlbGF0aW9uc2hpcHNba2V5XVsnZGF0YSddID0ge307XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuaXNfbmV3ID0gdHJ1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyB0b09iamVjdChwYXJhbXM6IEpzb25hcGkuSVBhcmFtcyk6IEpzb25hcGkuSURhdGFPYmplY3Qge1xuICAgICAgICAgICAgcGFyYW1zID0gYW5ndWxhci5leHRlbmQoe30sIEpzb25hcGkuQmFzZS5QYXJhbXMsIHBhcmFtcyk7XG4gICAgICAgICAgICB0aGlzLnNjaGVtYSA9IGFuZ3VsYXIuZXh0ZW5kKHt9LCBKc29uYXBpLkJhc2UuU2NoZW1hLCB0aGlzLnNjaGVtYSk7XG5cbiAgICAgICAgICAgIGxldCByZWxhdGlvbnNoaXBzID0geyB9O1xuICAgICAgICAgICAgbGV0IGluY2x1ZGVkID0gWyBdO1xuICAgICAgICAgICAgbGV0IGluY2x1ZGVkX2lkcyA9IFsgXTsgLy9qdXN0IGZvciBjb250cm9sIGRvbid0IHJlcGVhdCBhbnkgcmVzb3VyY2VcblxuICAgICAgICAgICAgLy8gYWdyZWdvIGNhZGEgcmVsYXRpb25zaGlwXG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2godGhpcy5yZWxhdGlvbnNoaXBzLCAocmVsYXRpb25zaGlwLCByZWxhdGlvbl9hbGlhcykgPT4ge1xuXG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuc2NoZW1hLnJlbGF0aW9uc2hpcHNbcmVsYXRpb25fYWxpYXNdICYmIHRoaXMuc2NoZW1hLnJlbGF0aW9uc2hpcHNbcmVsYXRpb25fYWxpYXNdLmhhc01hbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc1tyZWxhdGlvbl9hbGlhc10gPSB7IGRhdGE6IFtdIH07XG5cbiAgICAgICAgICAgICAgICAgICAgYW5ndWxhci5mb3JFYWNoKHJlbGF0aW9uc2hpcC5kYXRhLCAocmVzb3VyY2U6IEpzb25hcGkuSVJlc291cmNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgcmVhdGlvbmFsX29iamVjdCA9IHsgaWQ6IHJlc291cmNlLmlkLCB0eXBlOiByZXNvdXJjZS50eXBlIH07XG4gICAgICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnNoaXBzW3JlbGF0aW9uX2FsaWFzXVsnZGF0YSddLnB1c2gocmVhdGlvbmFsX29iamVjdCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIG5vIHNlIGFncmVnw7MgYcO6biBhIGluY2x1ZGVkICYmIHNlIGhhIHBlZGlkbyBpbmNsdWlyIGNvbiBlbCBwYXJtcy5pbmNsdWRlXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGVtcG9yYWxfaWQgPSByZXNvdXJjZS50eXBlICsgJ18nICsgcmVzb3VyY2UuaWQ7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaW5jbHVkZWRfaWRzLmluZGV4T2YodGVtcG9yYWxfaWQpID09PSAtMSAmJiBwYXJhbXMuaW5jbHVkZS5pbmRleE9mKHJlbGF0aW9uX2FsaWFzKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmNsdWRlZF9pZHMucHVzaCh0ZW1wb3JhbF9pZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVkZWQucHVzaChyZXNvdXJjZS50b09iamVjdCh7IH0pLmRhdGEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoISgnaWQnIGluIHJlbGF0aW9uc2hpcC5kYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKHJlbGF0aW9uX2FsaWFzICsgJyBkZWZpbmVkIHdpdGggaGFzTWFueTpmYWxzZSwgYnV0IEkgaGF2ZSBhIGNvbGxlY3Rpb24nKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uc2hpcHNbcmVsYXRpb25fYWxpYXNdID0geyBkYXRhOiB7IGlkOiByZWxhdGlvbnNoaXAuZGF0YS5pZCwgdHlwZTogcmVsYXRpb25zaGlwLmRhdGEudHlwZSB9IH07XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gbm8gc2UgYWdyZWfDsyBhw7puIGEgaW5jbHVkZWQgJiYgc2UgaGEgcGVkaWRvIGluY2x1aXIgY29uIGVsIHBhcm1zLmluY2x1ZGVcbiAgICAgICAgICAgICAgICAgICAgbGV0IHRlbXBvcmFsX2lkID0gcmVsYXRpb25zaGlwLmRhdGEudHlwZSArICdfJyArIHJlbGF0aW9uc2hpcC5kYXRhLmlkO1xuICAgICAgICAgICAgICAgICAgICBpZiAoaW5jbHVkZWRfaWRzLmluZGV4T2YodGVtcG9yYWxfaWQpID09PSAtMSAmJiBwYXJhbXMuaW5jbHVkZS5pbmRleE9mKHJlbGF0aW9uc2hpcC5kYXRhLnR5cGUpICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVkZWRfaWRzLnB1c2godGVtcG9yYWxfaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVkZWQucHVzaChyZWxhdGlvbnNoaXAuZGF0YS50b09iamVjdCh7IH0pLmRhdGEpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGxldCByZXQ6IElEYXRhT2JqZWN0ID0ge1xuICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogdGhpcy50eXBlLFxuICAgICAgICAgICAgICAgICAgICBpZDogdGhpcy5pZCxcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlczogdGhpcy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnNoaXBzOiByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKGluY2x1ZGVkLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICByZXQuaW5jbHVkZWQgPSBpbmNsdWRlZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJldDtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBnZXQ8VCBleHRlbmRzIEpzb25hcGkuSVJlc291cmNlPihpZDogc3RyaW5nLCBwYXJhbXM/OiBPYmplY3QgfCBGdW5jdGlvbiwgZmNfc3VjY2Vzcz86IEZ1bmN0aW9uLCBmY19lcnJvcj86IEZ1bmN0aW9uKTogVCB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fX2V4ZWMoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsICdnZXQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBkZWxldGUoaWQ6IHN0cmluZywgcGFyYW1zPzogT2JqZWN0IHwgRnVuY3Rpb24sIGZjX3N1Y2Nlc3M/OiBGdW5jdGlvbiwgZmNfZXJyb3I/OiBGdW5jdGlvbik6IHZvaWQge1xuICAgICAgICAgICAgdGhpcy5fX2V4ZWMoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsICdkZWxldGUnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBhbGw8VCBleHRlbmRzIEpzb25hcGkuSVJlc291cmNlPihwYXJhbXM/OiBPYmplY3QgfCBGdW5jdGlvbiwgZmNfc3VjY2Vzcz86IEZ1bmN0aW9uLCBmY19lcnJvcj86IEZ1bmN0aW9uKTogQXJyYXk8VD4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX19leGVjKG51bGwsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsICdhbGwnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBzYXZlPFQgZXh0ZW5kcyBKc29uYXBpLklSZXNvdXJjZT4ocGFyYW1zPzogT2JqZWN0IHwgRnVuY3Rpb24sIGZjX3N1Y2Nlc3M/OiBGdW5jdGlvbiwgZmNfZXJyb3I/OiBGdW5jdGlvbik6IEFycmF5PFQ+IHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9fZXhlYyhudWxsLCBwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yLCAnc2F2ZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgIFRoaXMgbWV0aG9kIHNvcnQgcGFyYW1zIGZvciBuZXcoKSwgZ2V0KCkgYW5kIHVwZGF0ZSgpXG4gICAgICAgICovXG4gICAgICAgIHByaXZhdGUgX19leGVjKGlkOiBzdHJpbmcsIHBhcmFtczogSnNvbmFwaS5JUGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvciwgZXhlY190eXBlOiBzdHJpbmcpOiBhbnkge1xuICAgICAgICAgICAgLy8gbWFrZXMgYHBhcmFtc2Agb3B0aW9uYWxcbiAgICAgICAgICAgIGlmIChhbmd1bGFyLmlzRnVuY3Rpb24ocGFyYW1zKSkge1xuICAgICAgICAgICAgICAgIGZjX2Vycm9yID0gZmNfc3VjY2VzcztcbiAgICAgICAgICAgICAgICBmY19zdWNjZXNzID0gcGFyYW1zO1xuICAgICAgICAgICAgICAgIHBhcmFtcyA9IEpzb25hcGkuQmFzZS5QYXJhbXM7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGlmIChhbmd1bGFyLmlzVW5kZWZpbmVkKHBhcmFtcykpIHtcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zID0gSnNvbmFwaS5CYXNlLlBhcmFtcztcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbXMgPSBhbmd1bGFyLmV4dGVuZCh7fSwgSnNvbmFwaS5CYXNlLlBhcmFtcywgcGFyYW1zKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZjX3N1Y2Nlc3MgPSBhbmd1bGFyLmlzRnVuY3Rpb24oZmNfc3VjY2VzcykgPyBmY19zdWNjZXNzIDogZnVuY3Rpb24gKCkge307XG4gICAgICAgICAgICBmY19lcnJvciA9IGFuZ3VsYXIuaXNGdW5jdGlvbihmY19lcnJvcikgPyBmY19lcnJvciA6IGZ1bmN0aW9uICgpIHt9O1xuXG4gICAgICAgICAgICB0aGlzLnNjaGVtYSA9IGFuZ3VsYXIuZXh0ZW5kKHt9LCBKc29uYXBpLkJhc2UuU2NoZW1hLCB0aGlzLnNjaGVtYSk7XG5cbiAgICAgICAgICAgIHN3aXRjaCAoZXhlY190eXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAnZ2V0JzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZ2V0KGlkLCBwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLl9kZWxldGUoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpO1xuICAgICAgICAgICAgICAgIGNhc2UgJ2FsbCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2FsbChwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgICAgICBjYXNlICdzYXZlJzpcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fc2F2ZShwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBfZ2V0KGlkOiBzdHJpbmcsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpOiBJUmVzb3VyY2Uge1xuICAgICAgICAgICAgLy8gaHR0cCByZXF1ZXN0XG4gICAgICAgICAgICBsZXQgcGF0aCA9IG5ldyBKc29uYXBpLlBhdGhNYWtlcigpO1xuICAgICAgICAgICAgcGF0aC5hZGRQYXRoKHRoaXMuZ2V0UGF0aCgpKTtcbiAgICAgICAgICAgIHBhdGguYWRkUGF0aChpZCk7XG4gICAgICAgICAgICBwYXJhbXMuaW5jbHVkZSA/IHBhdGguc2V0SW5jbHVkZShwYXJhbXMuaW5jbHVkZSkgOiBudWxsO1xuXG4gICAgICAgICAgICBsZXQgcmVzb3VyY2UgPSB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZSAmJiB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZVtpZF0gPyB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZVtpZF0gOiB0aGlzLm5ldygpO1xuXG4gICAgICAgICAgICBKc29uYXBpLkNvcmUuU2VydmljZXMuSnNvbmFwaUh0dHBcbiAgICAgICAgICAgIC5nZXQocGF0aC5nZXQoKSlcbiAgICAgICAgICAgIC50aGVuKFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3MgPT4ge1xuICAgICAgICAgICAgICAgICAgICBDb252ZXJ0ZXIuYnVpbGQoc3VjY2Vzcy5kYXRhLCByZXNvdXJjZSwgdGhpcy5zY2hlbWEpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmZpbGxDYWNoZVJlc291cmNlKHJlc291cmNlKTtcbiAgICAgICAgICAgICAgICAgICAgZmNfc3VjY2VzcyhzdWNjZXNzKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZmNfZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiByZXNvdXJjZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBfYWxsKHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpOiBPYmplY3QgeyAvLyBBcnJheTxJUmVzb3VyY2U+IHtcblxuICAgICAgICAgICAgLy8gaHR0cCByZXF1ZXN0XG4gICAgICAgICAgICBsZXQgcGF0aCA9IG5ldyBKc29uYXBpLlBhdGhNYWtlcigpO1xuICAgICAgICAgICAgcGF0aC5hZGRQYXRoKHRoaXMuZ2V0UGF0aCgpKTtcbiAgICAgICAgICAgIHBhcmFtcy5pbmNsdWRlID8gcGF0aC5zZXRJbmNsdWRlKHBhcmFtcy5pbmNsdWRlKSA6IG51bGw7XG5cbiAgICAgICAgICAgIC8vIG1ha2UgcmVxdWVzdFxuICAgICAgICAgICAgbGV0IHJlc291cmNlID0geyB9O1xuICAgICAgICAgICAgaWYgKHRoaXMuZ2V0U2VydmljZSgpLmNhY2hlKSB7XG4gICAgICAgICAgICAgICAgLy8gd2UgZG9uJ3QgbWFrZVxuICAgICAgICAgICAgICAgIGFuZ3VsYXIuZm9yRWFjaCh0aGlzLmdldFNlcnZpY2UoKS5jYWNoZSwgKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2Vba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBKc29uYXBpLkNvcmUuU2VydmljZXMuSnNvbmFwaUh0dHBcbiAgICAgICAgICAgIC5nZXQocGF0aC5nZXQoKSlcbiAgICAgICAgICAgIC50aGVuKFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3MgPT4ge1xuICAgICAgICAgICAgICAgICAgICBDb252ZXJ0ZXIuYnVpbGQoc3VjY2Vzcy5kYXRhLCByZXNvdXJjZSwgdGhpcy5zY2hlbWEpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmZpbGxDYWNoZShyZXNvdXJjZSk7XG4gICAgICAgICAgICAgICAgICAgIGZjX3N1Y2Nlc3Moc3VjY2Vzcyk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZjX2Vycm9yKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcHVibGljIF9kZWxldGUoaWQ6IHN0cmluZywgcGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvcik6IHZvaWQge1xuICAgICAgICAgICAgLy8gaHR0cCByZXF1ZXN0XG4gICAgICAgICAgICBsZXQgcGF0aCA9IG5ldyBKc29uYXBpLlBhdGhNYWtlcigpO1xuICAgICAgICAgICAgcGF0aC5hZGRQYXRoKHRoaXMuZ2V0UGF0aCgpKTtcbiAgICAgICAgICAgIHBhdGguYWRkUGF0aChpZCk7XG5cbiAgICAgICAgICAgIEpzb25hcGkuQ29yZS5TZXJ2aWNlcy5Kc29uYXBpSHR0cFxuICAgICAgICAgICAgLmRlbGV0ZShwYXRoLmdldCgpKVxuICAgICAgICAgICAgLnRoZW4oXG4gICAgICAgICAgICAgICAgc3VjY2VzcyA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZjX3N1Y2Nlc3Moc3VjY2Vzcyk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBlcnJvciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGZjX2Vycm9yKGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgcHVibGljIF9zYXZlKHBhcmFtczogSVBhcmFtcywgZmNfc3VjY2VzczogRnVuY3Rpb24sIGZjX2Vycm9yOiBGdW5jdGlvbik6IElSZXNvdXJjZSB7XG4gICAgICAgICAgICBsZXQgb2JqZWN0ID0gdGhpcy50b09iamVjdChwYXJhbXMpO1xuXG4gICAgICAgICAgICAvLyBodHRwIHJlcXVlc3RcbiAgICAgICAgICAgIGxldCBwYXRoID0gbmV3IEpzb25hcGkuUGF0aE1ha2VyKCk7XG4gICAgICAgICAgICBwYXRoLmFkZFBhdGgodGhpcy5nZXRQYXRoKCkpO1xuICAgICAgICAgICAgdGhpcy5pZCAmJiBwYXRoLmFkZFBhdGgodGhpcy5pZCk7XG4gICAgICAgICAgICBwYXJhbXMuaW5jbHVkZSA/IHBhdGguc2V0SW5jbHVkZShwYXJhbXMuaW5jbHVkZSkgOiBudWxsO1xuXG4gICAgICAgICAgICBsZXQgcmVzb3VyY2UgPSB0aGlzLm5ldygpO1xuXG4gICAgICAgICAgICBsZXQgcHJvbWlzZSA9IEpzb25hcGkuQ29yZS5TZXJ2aWNlcy5Kc29uYXBpSHR0cC5leGVjKHBhdGguZ2V0KCksIHRoaXMuaWQgPyAnUFVUJyA6ICdQT1NUJywgb2JqZWN0KTtcblxuICAgICAgICAgICAgcHJvbWlzZS50aGVuKFxuICAgICAgICAgICAgICAgIHN1Y2Nlc3MgPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgdmFsdWUgPSBzdWNjZXNzLmRhdGEuZGF0YTtcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2UuYXR0cmlidXRlcyA9IHZhbHVlLmF0dHJpYnV0ZXM7XG4gICAgICAgICAgICAgICAgICAgIHJlc291cmNlLmlkID0gdmFsdWUuaWQ7XG5cbiAgICAgICAgICAgICAgICAgICAgZmNfc3VjY2VzcyhzdWNjZXNzKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGVycm9yID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZmNfZXJyb3IoJ2RhdGEnIGluIGVycm9yID8gZXJyb3IuZGF0YSA6IGVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgYWRkUmVsYXRpb25zaGlwPFQgZXh0ZW5kcyBKc29uYXBpLklSZXNvdXJjZT4ocmVzb3VyY2U6IFQsIHR5cGVfYWxpYXM/OiBzdHJpbmcpIHtcbiAgICAgICAgICAgIHR5cGVfYWxpYXMgPSAodHlwZV9hbGlhcyA/IHR5cGVfYWxpYXMgOiByZXNvdXJjZS50eXBlKTtcbiAgICAgICAgICAgIGlmICghKHR5cGVfYWxpYXMgaW4gdGhpcy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgICAgICAgIHRoaXMucmVsYXRpb25zaGlwc1t0eXBlX2FsaWFzXSA9IHsgZGF0YTogeyB9IH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBvYmplY3Rfa2V5ID0gcmVzb3VyY2UuaWQ7XG4gICAgICAgICAgICBpZiAoIW9iamVjdF9rZXkpIHtcbiAgICAgICAgICAgICAgICBvYmplY3Rfa2V5ID0gJ25ld18nICsgKE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMCkpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLnJlbGF0aW9uc2hpcHNbdHlwZV9hbGlhc11bJ2RhdGEnXVtvYmplY3Rfa2V5XSA9IHJlc291cmNlO1xuICAgICAgICB9XG5cbiAgICAgICAgcHVibGljIHJlbW92ZVJlbGF0aW9uc2hpcCh0eXBlX2FsaWFzOiBzdHJpbmcsIGlkOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICAgICAgICAgIGlmICghKHR5cGVfYWxpYXMgaW4gdGhpcy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghKCdkYXRhJyBpbiB0aGlzLnJlbGF0aW9uc2hpcHNbdHlwZV9hbGlhc10pKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCEoaWQgaW4gdGhpcy5yZWxhdGlvbnNoaXBzW3R5cGVfYWxpYXNdWydkYXRhJ10pKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZGVsZXRlIHRoaXMucmVsYXRpb25zaGlwc1t0eXBlX2FsaWFzXVsnZGF0YSddW2lkXTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBmaWxsQ2FjaGUocmVzb3VyY2VzKSB7XG4gICAgICAgICAgICBpZiAocmVzb3VyY2VzLmlkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5maWxsQ2FjaGVSZXNvdXJjZShyZXNvdXJjZXMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGxDYWNoZVJlc291cmNlcyhyZXNvdXJjZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBmaWxsQ2FjaGVSZXNvdXJjZXM8VCBleHRlbmRzIEpzb25hcGkuSVJlc291cmNlPihyZXNvdXJjZXM6IEFycmF5PFQ+KSB7XG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2gocmVzb3VyY2VzLCAocmVzb3VyY2UpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGxDYWNoZVJlc291cmNlKHJlc291cmNlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcHJpdmF0ZSBmaWxsQ2FjaGVSZXNvdXJjZTxUIGV4dGVuZHMgSnNvbmFwaS5JUmVzb3VyY2U+KHJlc291cmNlOiBUKSB7XG4gICAgICAgICAgICBpZiAocmVzb3VyY2UuaWQpXG4gICAgICAgICAgICAgICAgdGhpcy5nZXRTZXJ2aWNlKCkuY2FjaGVbcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgQHJldHVybiBUaGlzIHJlc291cmNlIGxpa2UgYSBzZXJ2aWNlXG4gICAgICAgICoqL1xuICAgICAgICBwdWJsaWMgZ2V0U2VydmljZSgpOiBhbnkge1xuICAgICAgICAgICAgcmV0dXJuIENvbnZlcnRlci5nZXRTZXJ2aWNlKHRoaXMudHlwZSk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBSZXNvdXJjZSA9IChmdW5jdGlvbiAoKSB7XG4gICAgICAgIGZ1bmN0aW9uIFJlc291cmNlKCkge1xuICAgICAgICAgICAgdGhpcy5pc19uZXcgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5yZWxhdGlvbnNoaXBzID0ge307IC8vW107XG4gICAgICAgIH1cbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGNsb25lT2JqID0gbmV3IHRoaXMuY29uc3RydWN0b3IoKTtcbiAgICAgICAgICAgIGZvciAodmFyIGF0dHJpYnV0IGluIHRoaXMpIHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHRoaXNbYXR0cmlidXRdICE9PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgICAgICBjbG9uZU9ialthdHRyaWJ1dF0gPSB0aGlzW2F0dHJpYnV0XTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY2xvbmVPYmo7XG4gICAgICAgIH07XG4gICAgICAgIC8qKlxuICAgICAgICBSZWdpc3RlciBzY2hlbWEgb24gSnNvbmFwaS5Db3JlXG4gICAgICAgIEByZXR1cm4gdHJ1ZSBpZiB0aGUgcmVzb3VyY2UgZG9uJ3QgZXhpc3QgYW5kIHJlZ2lzdGVyZWQgb2tcbiAgICAgICAgKiovXG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5yZWdpc3RlciA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChKc29uYXBpLkNvcmUuTWUgPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyAnRXJyb3I6IHlvdSBhcmUgdHJ5aW5nIHJlZ2lzdGVyIC0tPiAnICsgdGhpcy50eXBlICsgJyA8LS0gYmVmb3JlIGluamVjdCBKc29uYXBpQ29yZSBzb21ld2hlcmUsIGFsbW9zdCBvbmUgdGltZS4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gb25seSB3aGVuIHNlcnZpY2UgaXMgcmVnaXN0ZXJlZCwgbm90IGNsb25lZCBvYmplY3RcbiAgICAgICAgICAgIHRoaXMuY2FjaGUgPSB7fTtcbiAgICAgICAgICAgIHJldHVybiBKc29uYXBpLkNvcmUuTWUuX3JlZ2lzdGVyKHRoaXMpO1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUuZ2V0UGF0aCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnBhdGggPyB0aGlzLnBhdGggOiB0aGlzLnR5cGU7XG4gICAgICAgIH07XG4gICAgICAgIC8vIGVtcHR5IHNlbGYgb2JqZWN0XG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5uZXcgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSB0aGlzLmNsb25lKCk7XG4gICAgICAgICAgICByZXNvdXJjZS5yZXNldCgpO1xuICAgICAgICAgICAgcmV0dXJuIHJlc291cmNlO1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgICB0aGlzLmlkID0gJyc7XG4gICAgICAgICAgICB0aGlzLmF0dHJpYnV0ZXMgPSB7fTtcbiAgICAgICAgICAgIHRoaXMucmVsYXRpb25zaGlwcyA9IHt9O1xuICAgICAgICAgICAgYW5ndWxhci5mb3JFYWNoKHRoaXMuc2NoZW1hLnJlbGF0aW9uc2hpcHMsIGZ1bmN0aW9uICh2YWx1ZSwga2V5KSB7XG4gICAgICAgICAgICAgICAgc2VsZi5yZWxhdGlvbnNoaXBzW2tleV0gPSB7fTtcbiAgICAgICAgICAgICAgICBzZWxmLnJlbGF0aW9uc2hpcHNba2V5XVsnZGF0YSddID0ge307XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMuaXNfbmV3ID0gdHJ1ZTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLnRvT2JqZWN0ID0gZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICAgICAgdmFyIF90aGlzID0gdGhpcztcbiAgICAgICAgICAgIHBhcmFtcyA9IGFuZ3VsYXIuZXh0ZW5kKHt9LCBKc29uYXBpLkJhc2UuUGFyYW1zLCBwYXJhbXMpO1xuICAgICAgICAgICAgdGhpcy5zY2hlbWEgPSBhbmd1bGFyLmV4dGVuZCh7fSwgSnNvbmFwaS5CYXNlLlNjaGVtYSwgdGhpcy5zY2hlbWEpO1xuICAgICAgICAgICAgdmFyIHJlbGF0aW9uc2hpcHMgPSB7fTtcbiAgICAgICAgICAgIHZhciBpbmNsdWRlZCA9IFtdO1xuICAgICAgICAgICAgdmFyIGluY2x1ZGVkX2lkcyA9IFtdOyAvL2p1c3QgZm9yIGNvbnRyb2wgZG9uJ3QgcmVwZWF0IGFueSByZXNvdXJjZVxuICAgICAgICAgICAgLy8gYWdyZWdvIGNhZGEgcmVsYXRpb25zaGlwXG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2godGhpcy5yZWxhdGlvbnNoaXBzLCBmdW5jdGlvbiAocmVsYXRpb25zaGlwLCByZWxhdGlvbl9hbGlhcykge1xuICAgICAgICAgICAgICAgIGlmIChfdGhpcy5zY2hlbWEucmVsYXRpb25zaGlwc1tyZWxhdGlvbl9hbGlhc10gJiYgX3RoaXMuc2NoZW1hLnJlbGF0aW9uc2hpcHNbcmVsYXRpb25fYWxpYXNdLmhhc01hbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRpb25zaGlwc1tyZWxhdGlvbl9hbGlhc10gPSB7IGRhdGE6IFtdIH07XG4gICAgICAgICAgICAgICAgICAgIGFuZ3VsYXIuZm9yRWFjaChyZWxhdGlvbnNoaXAuZGF0YSwgZnVuY3Rpb24gKHJlc291cmNlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcmVhdGlvbmFsX29iamVjdCA9IHsgaWQ6IHJlc291cmNlLmlkLCB0eXBlOiByZXNvdXJjZS50eXBlIH07XG4gICAgICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnNoaXBzW3JlbGF0aW9uX2FsaWFzXVsnZGF0YSddLnB1c2gocmVhdGlvbmFsX29iamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBubyBzZSBhZ3JlZ8OzIGHDum4gYSBpbmNsdWRlZCAmJiBzZSBoYSBwZWRpZG8gaW5jbHVpciBjb24gZWwgcGFybXMuaW5jbHVkZVxuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIHRlbXBvcmFsX2lkID0gcmVzb3VyY2UudHlwZSArICdfJyArIHJlc291cmNlLmlkO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVkX2lkcy5pbmRleE9mKHRlbXBvcmFsX2lkKSA9PT0gLTEgJiYgcGFyYW1zLmluY2x1ZGUuaW5kZXhPZihyZWxhdGlvbl9hbGlhcykgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaW5jbHVkZWRfaWRzLnB1c2godGVtcG9yYWxfaWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1ZGVkLnB1c2gocmVzb3VyY2UudG9PYmplY3Qoe30pLmRhdGEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghKCdpZCcgaW4gcmVsYXRpb25zaGlwLmRhdGEpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4ocmVsYXRpb25fYWxpYXMgKyAnIGRlZmluZWQgd2l0aCBoYXNNYW55OmZhbHNlLCBidXQgSSBoYXZlIGEgY29sbGVjdGlvbicpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJlbGF0aW9uc2hpcHNbcmVsYXRpb25fYWxpYXNdID0geyBkYXRhOiB7IGlkOiByZWxhdGlvbnNoaXAuZGF0YS5pZCwgdHlwZTogcmVsYXRpb25zaGlwLmRhdGEudHlwZSB9IH07XG4gICAgICAgICAgICAgICAgICAgIC8vIG5vIHNlIGFncmVnw7MgYcO6biBhIGluY2x1ZGVkICYmIHNlIGhhIHBlZGlkbyBpbmNsdWlyIGNvbiBlbCBwYXJtcy5pbmNsdWRlXG4gICAgICAgICAgICAgICAgICAgIHZhciB0ZW1wb3JhbF9pZCA9IHJlbGF0aW9uc2hpcC5kYXRhLnR5cGUgKyAnXycgKyByZWxhdGlvbnNoaXAuZGF0YS5pZDtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGluY2x1ZGVkX2lkcy5pbmRleE9mKHRlbXBvcmFsX2lkKSA9PT0gLTEgJiYgcGFyYW1zLmluY2x1ZGUuaW5kZXhPZihyZWxhdGlvbnNoaXAuZGF0YS50eXBlKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1ZGVkX2lkcy5wdXNoKHRlbXBvcmFsX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluY2x1ZGVkLnB1c2gocmVsYXRpb25zaGlwLmRhdGEudG9PYmplY3Qoe30pLmRhdGEpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB2YXIgcmV0ID0ge1xuICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogdGhpcy50eXBlLFxuICAgICAgICAgICAgICAgICAgICBpZDogdGhpcy5pZCxcbiAgICAgICAgICAgICAgICAgICAgYXR0cmlidXRlczogdGhpcy5hdHRyaWJ1dGVzLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGlvbnNoaXBzOiByZWxhdGlvbnNoaXBzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChpbmNsdWRlZC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgcmV0LmluY2x1ZGVkID0gaW5jbHVkZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmV0O1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKGlkLCBwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fX2V4ZWMoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsICdnZXQnKTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLmRlbGV0ZSA9IGZ1bmN0aW9uIChpZCwgcGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvcikge1xuICAgICAgICAgICAgdGhpcy5fX2V4ZWMoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsICdkZWxldGUnKTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLmFsbCA9IGZ1bmN0aW9uIChwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fX2V4ZWMobnVsbCwgcGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvciwgJ2FsbCcpO1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUuc2F2ZSA9IGZ1bmN0aW9uIChwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fX2V4ZWMobnVsbCwgcGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvciwgJ3NhdmUnKTtcbiAgICAgICAgfTtcbiAgICAgICAgLyoqXG4gICAgICAgIFRoaXMgbWV0aG9kIHNvcnQgcGFyYW1zIGZvciBuZXcoKSwgZ2V0KCkgYW5kIHVwZGF0ZSgpXG4gICAgICAgICovXG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5fX2V4ZWMgPSBmdW5jdGlvbiAoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IsIGV4ZWNfdHlwZSkge1xuICAgICAgICAgICAgLy8gbWFrZXMgYHBhcmFtc2Agb3B0aW9uYWxcbiAgICAgICAgICAgIGlmIChhbmd1bGFyLmlzRnVuY3Rpb24ocGFyYW1zKSkge1xuICAgICAgICAgICAgICAgIGZjX2Vycm9yID0gZmNfc3VjY2VzcztcbiAgICAgICAgICAgICAgICBmY19zdWNjZXNzID0gcGFyYW1zO1xuICAgICAgICAgICAgICAgIHBhcmFtcyA9IEpzb25hcGkuQmFzZS5QYXJhbXM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoYW5ndWxhci5pc1VuZGVmaW5lZChwYXJhbXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIHBhcmFtcyA9IEpzb25hcGkuQmFzZS5QYXJhbXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBwYXJhbXMgPSBhbmd1bGFyLmV4dGVuZCh7fSwgSnNvbmFwaS5CYXNlLlBhcmFtcywgcGFyYW1zKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmY19zdWNjZXNzID0gYW5ndWxhci5pc0Z1bmN0aW9uKGZjX3N1Y2Nlc3MpID8gZmNfc3VjY2VzcyA6IGZ1bmN0aW9uICgpIHsgfTtcbiAgICAgICAgICAgIGZjX2Vycm9yID0gYW5ndWxhci5pc0Z1bmN0aW9uKGZjX2Vycm9yKSA/IGZjX2Vycm9yIDogZnVuY3Rpb24gKCkgeyB9O1xuICAgICAgICAgICAgdGhpcy5zY2hlbWEgPSBhbmd1bGFyLmV4dGVuZCh7fSwgSnNvbmFwaS5CYXNlLlNjaGVtYSwgdGhpcy5zY2hlbWEpO1xuICAgICAgICAgICAgc3dpdGNoIChleGVjX3R5cGUpIHtcbiAgICAgICAgICAgICAgICBjYXNlICdnZXQnOlxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZ2V0KGlkLCBwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgICAgICBjYXNlICdkZWxldGUnOlxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fZGVsZXRlKGlkLCBwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgICAgICBjYXNlICdhbGwnOlxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fYWxsKHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3NhdmUnOlxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5fc2F2ZShwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLl9nZXQgPSBmdW5jdGlvbiAoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpIHtcbiAgICAgICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgICAgICAvLyBodHRwIHJlcXVlc3RcbiAgICAgICAgICAgIHZhciBwYXRoID0gbmV3IEpzb25hcGkuUGF0aE1ha2VyKCk7XG4gICAgICAgICAgICBwYXRoLmFkZFBhdGgodGhpcy5nZXRQYXRoKCkpO1xuICAgICAgICAgICAgcGF0aC5hZGRQYXRoKGlkKTtcbiAgICAgICAgICAgIHBhcmFtcy5pbmNsdWRlID8gcGF0aC5zZXRJbmNsdWRlKHBhcmFtcy5pbmNsdWRlKSA6IG51bGw7XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZSAmJiB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZVtpZF0gPyB0aGlzLmdldFNlcnZpY2UoKS5jYWNoZVtpZF0gOiB0aGlzLm5ldygpO1xuICAgICAgICAgICAgSnNvbmFwaS5Db3JlLlNlcnZpY2VzLkpzb25hcGlIdHRwXG4gICAgICAgICAgICAgICAgLmdldChwYXRoLmdldCgpKVxuICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChzdWNjZXNzKSB7XG4gICAgICAgICAgICAgICAgSnNvbmFwaS5Db252ZXJ0ZXIuYnVpbGQoc3VjY2Vzcy5kYXRhLCByZXNvdXJjZSwgX3RoaXMuc2NoZW1hKTtcbiAgICAgICAgICAgICAgICBfdGhpcy5maWxsQ2FjaGVSZXNvdXJjZShyZXNvdXJjZSk7XG4gICAgICAgICAgICAgICAgZmNfc3VjY2VzcyhzdWNjZXNzKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGZjX2Vycm9yKGVycm9yKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHJlc291cmNlO1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUuX2FsbCA9IGZ1bmN0aW9uIChwYXJhbXMsIGZjX3N1Y2Nlc3MsIGZjX2Vycm9yKSB7XG4gICAgICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICAgICAgLy8gaHR0cCByZXF1ZXN0XG4gICAgICAgICAgICB2YXIgcGF0aCA9IG5ldyBKc29uYXBpLlBhdGhNYWtlcigpO1xuICAgICAgICAgICAgcGF0aC5hZGRQYXRoKHRoaXMuZ2V0UGF0aCgpKTtcbiAgICAgICAgICAgIHBhcmFtcy5pbmNsdWRlID8gcGF0aC5zZXRJbmNsdWRlKHBhcmFtcy5pbmNsdWRlKSA6IG51bGw7XG4gICAgICAgICAgICAvLyBtYWtlIHJlcXVlc3RcbiAgICAgICAgICAgIHZhciByZXNvdXJjZSA9IHt9O1xuICAgICAgICAgICAgaWYgKHRoaXMuZ2V0U2VydmljZSgpLmNhY2hlKSB7XG4gICAgICAgICAgICAgICAgLy8gd2UgZG9uJ3QgbWFrZVxuICAgICAgICAgICAgICAgIGFuZ3VsYXIuZm9yRWFjaCh0aGlzLmdldFNlcnZpY2UoKS5jYWNoZSwgZnVuY3Rpb24gKHZhbHVlLCBrZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb3VyY2Vba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgSnNvbmFwaS5Db3JlLlNlcnZpY2VzLkpzb25hcGlIdHRwXG4gICAgICAgICAgICAgICAgLmdldChwYXRoLmdldCgpKVxuICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChzdWNjZXNzKSB7XG4gICAgICAgICAgICAgICAgSnNvbmFwaS5Db252ZXJ0ZXIuYnVpbGQoc3VjY2Vzcy5kYXRhLCByZXNvdXJjZSwgX3RoaXMuc2NoZW1hKTtcbiAgICAgICAgICAgICAgICBfdGhpcy5maWxsQ2FjaGUocmVzb3VyY2UpO1xuICAgICAgICAgICAgICAgIGZjX3N1Y2Nlc3Moc3VjY2Vzcyk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBmY19lcnJvcihlcnJvcik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHVybiByZXNvdXJjZTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLl9kZWxldGUgPSBmdW5jdGlvbiAoaWQsIHBhcmFtcywgZmNfc3VjY2VzcywgZmNfZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIGh0dHAgcmVxdWVzdFxuICAgICAgICAgICAgdmFyIHBhdGggPSBuZXcgSnNvbmFwaS5QYXRoTWFrZXIoKTtcbiAgICAgICAgICAgIHBhdGguYWRkUGF0aCh0aGlzLmdldFBhdGgoKSk7XG4gICAgICAgICAgICBwYXRoLmFkZFBhdGgoaWQpO1xuICAgICAgICAgICAgSnNvbmFwaS5Db3JlLlNlcnZpY2VzLkpzb25hcGlIdHRwXG4gICAgICAgICAgICAgICAgLmRlbGV0ZShwYXRoLmdldCgpKVxuICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChzdWNjZXNzKSB7XG4gICAgICAgICAgICAgICAgZmNfc3VjY2VzcyhzdWNjZXNzKTtcbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGZjX2Vycm9yKGVycm9yKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBSZXNvdXJjZS5wcm90b3R5cGUuX3NhdmUgPSBmdW5jdGlvbiAocGFyYW1zLCBmY19zdWNjZXNzLCBmY19lcnJvcikge1xuICAgICAgICAgICAgdmFyIG9iamVjdCA9IHRoaXMudG9PYmplY3QocGFyYW1zKTtcbiAgICAgICAgICAgIC8vIGh0dHAgcmVxdWVzdFxuICAgICAgICAgICAgdmFyIHBhdGggPSBuZXcgSnNvbmFwaS5QYXRoTWFrZXIoKTtcbiAgICAgICAgICAgIHBhdGguYWRkUGF0aCh0aGlzLmdldFBhdGgoKSk7XG4gICAgICAgICAgICB0aGlzLmlkICYmIHBhdGguYWRkUGF0aCh0aGlzLmlkKTtcbiAgICAgICAgICAgIHBhcmFtcy5pbmNsdWRlID8gcGF0aC5zZXRJbmNsdWRlKHBhcmFtcy5pbmNsdWRlKSA6IG51bGw7XG4gICAgICAgICAgICB2YXIgcmVzb3VyY2UgPSB0aGlzLm5ldygpO1xuICAgICAgICAgICAgdmFyIHByb21pc2UgPSBKc29uYXBpLkNvcmUuU2VydmljZXMuSnNvbmFwaUh0dHAuZXhlYyhwYXRoLmdldCgpLCB0aGlzLmlkID8gJ1BVVCcgOiAnUE9TVCcsIG9iamVjdCk7XG4gICAgICAgICAgICBwcm9taXNlLnRoZW4oZnVuY3Rpb24gKHN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICB2YXIgdmFsdWUgPSBzdWNjZXNzLmRhdGEuZGF0YTtcbiAgICAgICAgICAgICAgICByZXNvdXJjZS5hdHRyaWJ1dGVzID0gdmFsdWUuYXR0cmlidXRlcztcbiAgICAgICAgICAgICAgICByZXNvdXJjZS5pZCA9IHZhbHVlLmlkO1xuICAgICAgICAgICAgICAgIGZjX3N1Y2Nlc3Moc3VjY2Vzcyk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBmY19lcnJvcignZGF0YScgaW4gZXJyb3IgPyBlcnJvci5kYXRhIDogZXJyb3IpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm4gcmVzb3VyY2U7XG4gICAgICAgIH07XG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5hZGRSZWxhdGlvbnNoaXAgPSBmdW5jdGlvbiAocmVzb3VyY2UsIHR5cGVfYWxpYXMpIHtcbiAgICAgICAgICAgIHR5cGVfYWxpYXMgPSAodHlwZV9hbGlhcyA/IHR5cGVfYWxpYXMgOiByZXNvdXJjZS50eXBlKTtcbiAgICAgICAgICAgIGlmICghKHR5cGVfYWxpYXMgaW4gdGhpcy5yZWxhdGlvbnNoaXBzKSkge1xuICAgICAgICAgICAgICAgIHRoaXMucmVsYXRpb25zaGlwc1t0eXBlX2FsaWFzXSA9IHsgZGF0YToge30gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBvYmplY3Rfa2V5ID0gcmVzb3VyY2UuaWQ7XG4gICAgICAgICAgICBpZiAoIW9iamVjdF9rZXkpIHtcbiAgICAgICAgICAgICAgICBvYmplY3Rfa2V5ID0gJ25ld18nICsgKE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDEwMDAwMCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5yZWxhdGlvbnNoaXBzW3R5cGVfYWxpYXNdWydkYXRhJ11bb2JqZWN0X2tleV0gPSByZXNvdXJjZTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLnJlbW92ZVJlbGF0aW9uc2hpcCA9IGZ1bmN0aW9uICh0eXBlX2FsaWFzLCBpZCkge1xuICAgICAgICAgICAgaWYgKCEodHlwZV9hbGlhcyBpbiB0aGlzLnJlbGF0aW9uc2hpcHMpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCEoJ2RhdGEnIGluIHRoaXMucmVsYXRpb25zaGlwc1t0eXBlX2FsaWFzXSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIShpZCBpbiB0aGlzLnJlbGF0aW9uc2hpcHNbdHlwZV9hbGlhc11bJ2RhdGEnXSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkZWxldGUgdGhpcy5yZWxhdGlvbnNoaXBzW3R5cGVfYWxpYXNdWydkYXRhJ11baWRdO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH07XG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5maWxsQ2FjaGUgPSBmdW5jdGlvbiAocmVzb3VyY2VzKSB7XG4gICAgICAgICAgICBpZiAocmVzb3VyY2VzLmlkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5maWxsQ2FjaGVSZXNvdXJjZShyZXNvdXJjZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5maWxsQ2FjaGVSZXNvdXJjZXMocmVzb3VyY2VzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLmZpbGxDYWNoZVJlc291cmNlcyA9IGZ1bmN0aW9uIChyZXNvdXJjZXMpIHtcbiAgICAgICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgICAgICBhbmd1bGFyLmZvckVhY2gocmVzb3VyY2VzLCBmdW5jdGlvbiAocmVzb3VyY2UpIHtcbiAgICAgICAgICAgICAgICBfdGhpcy5maWxsQ2FjaGVSZXNvdXJjZShyZXNvdXJjZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICAgICAgUmVzb3VyY2UucHJvdG90eXBlLmZpbGxDYWNoZVJlc291cmNlID0gZnVuY3Rpb24gKHJlc291cmNlKSB7XG4gICAgICAgICAgICBpZiAocmVzb3VyY2UuaWQpXG4gICAgICAgICAgICAgICAgdGhpcy5nZXRTZXJ2aWNlKCkuY2FjaGVbcmVzb3VyY2UuaWRdID0gcmVzb3VyY2U7XG4gICAgICAgIH07XG4gICAgICAgIC8qKlxuICAgICAgICBAcmV0dXJuIFRoaXMgcmVzb3VyY2UgbGlrZSBhIHNlcnZpY2VcbiAgICAgICAgKiovXG4gICAgICAgIFJlc291cmNlLnByb3RvdHlwZS5nZXRTZXJ2aWNlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIEpzb25hcGkuQ29udmVydGVyLmdldFNlcnZpY2UodGhpcy50eXBlKTtcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIFJlc291cmNlO1xuICAgIH0oKSk7XG4gICAgSnNvbmFwaS5SZXNvdXJjZSA9IFJlc291cmNlO1xufSkoSnNvbmFwaSB8fCAoSnNvbmFwaSA9IHt9KSk7XG4iLCIvLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi4vLi4vdHlwaW5ncy9tYWluLmQudHNcIiAvPlxuXG4vLyBKc29uYXBpIGludGVyZmFjZXMgcGFydCBvZiB0b3AgbGV2ZWxcbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvZG9jdW1lbnQuZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvZGF0YS1jb2xsZWN0aW9uLmQudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL2RhdGEtb2JqZWN0LmQudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL2RhdGEtcmVzb3VyY2UuZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvcGFyYW1zLmQudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL2Vycm9ycy5kLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vaW50ZXJmYWNlcy9saW5rcy5kLnRzXCIvPlxuXG4vLyBQYXJhbWV0ZXJzIGZvciBUUy1Kc29uYXBpIENsYXNzZXNcbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvc2NoZW1hLmQudHNcIi8+XG5cbi8vIFRTLUpzb25hcGkgQ2xhc3NlcyBJbnRlcmZhY2VzXG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL2NvcmUuZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvcmVzb3VyY2UuZC50c1wiLz5cblxuLy8gVFMtSnNvbmFwaSBjbGFzc2VzXG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9hcHAubW9kdWxlLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vc2VydmljZXMvYmFzZS50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL3NlcnZpY2VzL2h0dHAuc2VydmljZS50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL3NlcnZpY2VzL3BhdGgtbWFrZXIudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9zZXJ2aWNlcy9yZXNvdXJjZS1jb252ZXJ0ZXIudHNcIi8+XG4vLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vc2VydmljZXMvY29yZS1zZXJ2aWNlcy5zZXJ2aWNlLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vY29yZS50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL3Jlc291cmNlLnRzXCIvPlxuIiwiLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4uLy4uL3R5cGluZ3MvbWFpbi5kLnRzXCIgLz5cbi8vIEpzb25hcGkgaW50ZXJmYWNlcyBwYXJ0IG9mIHRvcCBsZXZlbFxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vaW50ZXJmYWNlcy9kb2N1bWVudC5kLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vaW50ZXJmYWNlcy9kYXRhLWNvbGxlY3Rpb24uZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvZGF0YS1vYmplY3QuZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvZGF0YS1yZXNvdXJjZS5kLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vaW50ZXJmYWNlcy9wYXJhbXMuZC50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvZXJyb3JzLmQudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL2xpbmtzLmQudHNcIi8+XG4vLyBQYXJhbWV0ZXJzIGZvciBUUy1Kc29uYXBpIENsYXNzZXNcbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2ludGVyZmFjZXMvc2NoZW1hLmQudHNcIi8+XG4vLyBUUy1Kc29uYXBpIENsYXNzZXMgSW50ZXJmYWNlc1xuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vaW50ZXJmYWNlcy9jb3JlLmQudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9pbnRlcmZhY2VzL3Jlc291cmNlLmQudHNcIi8+XG4vLyBUUy1Kc29uYXBpIGNsYXNzZXNcbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL2FwcC5tb2R1bGUudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9zZXJ2aWNlcy9iYXNlLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vc2VydmljZXMvaHR0cC5zZXJ2aWNlLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vc2VydmljZXMvcGF0aC1tYWtlci50c1wiLz5cbi8vLyA8cmVmZXJlbmNlIHBhdGg9XCIuL3NlcnZpY2VzL3Jlc291cmNlLWNvbnZlcnRlci50c1wiLz5cbi8vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9zZXJ2aWNlcy9jb3JlLXNlcnZpY2VzLnNlcnZpY2UudHNcIi8+XG4vLy8gPHJlZmVyZW5jZSBwYXRoPVwiLi9jb3JlLnRzXCIvPlxuLy8vIDxyZWZlcmVuY2UgcGF0aD1cIi4vcmVzb3VyY2UudHNcIi8+XG4iLCJtb2R1bGUgSnNvbmFwaSB7XG4gICAgZXhwb3J0IGNsYXNzIENvcmVTZXJ2aWNlcyB7XG5cbiAgICAgICAgLyoqIEBuZ0luamVjdCAqL1xuICAgICAgICBwdWJsaWMgY29uc3RydWN0b3IoXG4gICAgICAgICAgICBwcm90ZWN0ZWQgSnNvbmFwaUh0dHBcbiAgICAgICAgKSB7XG5cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFuZ3VsYXIubW9kdWxlKCdKc29uYXBpLnNlcnZpY2VzJykuc2VydmljZSgnSnNvbmFwaUNvcmVTZXJ2aWNlcycsIENvcmVTZXJ2aWNlcyk7XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBDb3JlU2VydmljZXMgPSAoZnVuY3Rpb24gKCkge1xuICAgICAgICAvKiogQG5nSW5qZWN0ICovXG4gICAgICAgIGZ1bmN0aW9uIENvcmVTZXJ2aWNlcyhKc29uYXBpSHR0cCkge1xuICAgICAgICAgICAgdGhpcy5Kc29uYXBpSHR0cCA9IEpzb25hcGlIdHRwO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBDb3JlU2VydmljZXM7XG4gICAgfSgpKTtcbiAgICBKc29uYXBpLkNvcmVTZXJ2aWNlcyA9IENvcmVTZXJ2aWNlcztcbiAgICBhbmd1bGFyLm1vZHVsZSgnSnNvbmFwaS5zZXJ2aWNlcycpLnNlcnZpY2UoJ0pzb25hcGlDb3JlU2VydmljZXMnLCBDb3JlU2VydmljZXMpO1xufSkoSnNvbmFwaSB8fCAoSnNvbmFwaSA9IHt9KSk7XG4iLCJtb2R1bGUgSnNvbmFwaSB7XG4gICAgZXhwb3J0IGNsYXNzIEpzb25hcGlQYXJzZXIge1xuXG4gICAgICAgIC8qKiBAbmdJbmplY3QgKi9cbiAgICAgICAgcHVibGljIGNvbnN0cnVjdG9yKCkge1xuXG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgdG9PYmplY3QoanNvbl9zdHJpbmc6IHN0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIGpzb25fc3RyaW5nO1xuICAgICAgICB9XG4gICAgfVxufVxuIiwidmFyIEpzb25hcGk7XG4oZnVuY3Rpb24gKEpzb25hcGkpIHtcbiAgICB2YXIgSnNvbmFwaVBhcnNlciA9IChmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8qKiBAbmdJbmplY3QgKi9cbiAgICAgICAgZnVuY3Rpb24gSnNvbmFwaVBhcnNlcigpIHtcbiAgICAgICAgfVxuICAgICAgICBKc29uYXBpUGFyc2VyLnByb3RvdHlwZS50b09iamVjdCA9IGZ1bmN0aW9uIChqc29uX3N0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIGpzb25fc3RyaW5nO1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gSnNvbmFwaVBhcnNlcjtcbiAgICB9KCkpO1xuICAgIEpzb25hcGkuSnNvbmFwaVBhcnNlciA9IEpzb25hcGlQYXJzZXI7XG59KShKc29uYXBpIHx8IChKc29uYXBpID0ge30pKTtcbiIsIm1vZHVsZSBKc29uYXBpIHtcbiAgICBleHBvcnQgY2xhc3MgSnNvbmFwaVN0b3JhZ2Uge1xuXG4gICAgICAgIC8qKiBAbmdJbmplY3QgKi9cbiAgICAgICAgcHVibGljIGNvbnN0cnVjdG9yKFxuICAgICAgICAgICAgLy8gcHJvdGVjdGVkIHN0b3JlLFxuICAgICAgICAgICAgLy8gcHJvdGVjdGVkIFJlYWxKc29uYXBpXG4gICAgICAgICkge1xuXG4gICAgICAgIH1cblxuICAgICAgICBwdWJsaWMgZ2V0KGtleSkge1xuICAgICAgICAgICAgLyogbGV0IGRhdGEgPSB0aGlzLnN0b3JlLmdldChrZXkpO1xuICAgICAgICAgICAgcmV0dXJuIGFuZ3VsYXIuZnJvbUpzb24oZGF0YSk7Ki9cbiAgICAgICAgfVxuXG4gICAgICAgIHB1YmxpYyBtZXJnZShrZXksIGRhdGEpIHtcbiAgICAgICAgICAgIC8qIGxldCBhY3R1YWxfZGF0YSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICAgICAgICBsZXQgYWN0dWFsX2luZm8gPSBhbmd1bGFyLmZyb21Kc29uKGFjdHVhbF9kYXRhKTsgKi9cblxuXG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJ2YXIgSnNvbmFwaTtcbihmdW5jdGlvbiAoSnNvbmFwaSkge1xuICAgIHZhciBKc29uYXBpU3RvcmFnZSA9IChmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8qKiBAbmdJbmplY3QgKi9cbiAgICAgICAgZnVuY3Rpb24gSnNvbmFwaVN0b3JhZ2UoKSB7XG4gICAgICAgIH1cbiAgICAgICAgSnNvbmFwaVN0b3JhZ2UucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgIC8qIGxldCBkYXRhID0gdGhpcy5zdG9yZS5nZXQoa2V5KTtcbiAgICAgICAgICAgIHJldHVybiBhbmd1bGFyLmZyb21Kc29uKGRhdGEpOyovXG4gICAgICAgIH07XG4gICAgICAgIEpzb25hcGlTdG9yYWdlLnByb3RvdHlwZS5tZXJnZSA9IGZ1bmN0aW9uIChrZXksIGRhdGEpIHtcbiAgICAgICAgICAgIC8qIGxldCBhY3R1YWxfZGF0YSA9IHRoaXMuZ2V0KGtleSk7XG4gICAgICAgICAgICBsZXQgYWN0dWFsX2luZm8gPSBhbmd1bGFyLmZyb21Kc29uKGFjdHVhbF9kYXRhKTsgKi9cbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIEpzb25hcGlTdG9yYWdlO1xuICAgIH0oKSk7XG4gICAgSnNvbmFwaS5Kc29uYXBpU3RvcmFnZSA9IEpzb25hcGlTdG9yYWdlO1xufSkoSnNvbmFwaSB8fCAoSnNvbmFwaSA9IHt9KSk7XG4iXSwic291cmNlUm9vdCI6Ii9zb3VyY2UvIn0=
