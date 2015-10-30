/*
 * Copyright (C) 2012-2014 by Coriolis Technologies Pvt Ltd.
 * This program is free software - see the file COPYING for license details.
 */

/*
 * This file contains generic media handlers for abstractions like directories,
 * bundles and links, built on top of vanilla filesystems. They can be reused
 * by filesystems like Dropbox and GDrive. This means one can archive and
 * create links on Dropbox and GDrive without the individual filesystems
 * having to implement bundles.
 */

var Dir = function(meta, opts) {
    this.mime = meta.mime || 'application/vnd.pigshell.dir';
    Dir.base.apply(this, arguments);
    this.files = {};
    this.populated = false;
    
    this.opts = $.extend({}, this.constructor.defaults, opts,
        this.fs.opts[this.mime]);
    this.bdl_re = this.opts.bdl_mime ? new RegExp("(.*)\\." + this.opts.bdl_ext + "$", "i") : null;
    this.html = sprintf('<div class="pfolder"><a href="%s" target="_blank">{{name}}</a></div>', this.ident);
    this.cookie = -1;
    this._update_time = 0;
};

inherit(Dir, MediaHandler);

["mkdir", "putdir", "link"].forEach(function(op) {
    Dir.prototype[op] = fstack_invaldir_wrap(op);
});

Dir.defaults = {
    cache_time: 0, /* Cache for x milliseconds */
    bdl_ext: "bdl", /* Bundle directory extension */
    bdl_mime: "application/vnd.pigshell.bundle"
};

Dir.prototype.readdir = function(opts, cb) {
    var self = this,
        bdlmime = self.opts.bdl_mime,
        ropts = opts.readdir || {};

    function makefiles(data) {

        var flist = [],
            base = URI.parse(self.redirect_url || self.ident),
            bfiles = self.files,
            bdls = [],
            bdlseen = {};
            
        if (bdlmime) {
            /* Bdls win any aliasing contest */
            data.files.forEach(function(el) {
                var bdlmatch = (el.mime === self.mime) ?
                    el.name.match(self.bdl_re) : null;
                if (bdlmatch) {
                    bdlseen[bdlmatch[1]] = true;
                    bdls.push(el);
                } else {
                    flist.push(el);
                }
            });
            flist = flist.filter(function(f) { return !bdlseen[f.name]; });
            flist = flist.concat(bdls);
        } else {
            flist = data.files;
        }
        self.files = {};
        async.forEachSeries(flist, function(el, lcb) {
            var uri = URI.parse(el.ident),
                ident = base.resolve(uri),
                bdlmatch = (bdlmime && el.mime === self.mime) ?
                    el.name.match(self.bdl_re) : null,
                entryname = bdlmatch ? bdlmatch[1] : el.name,
                bfile = bfiles[entryname];

            if (bfile && ident === bfile.ident) {
                if (el.mtime === bfile.mtime && el.size === bfile.size) {
                    self.files[entryname] = bfile;
                    return lcb(null);
                } else {
                    bfile.update(el, opts, function() {
                        self.files[entryname] = bfile;
                        return lcb(null);
                    });
                }
            } else {
                var klass = self.fs.constructor.fileclass,
                    file = new klass({ident: ident, name: el.name, fs: self.fs});
                file.update(el, opts, function(err, res) {
                    self.files[entryname] = file;
                    return lcb(null);
                });
            }
        }, function(err) {
            self.populated = true;
            return cb(null, fstack_topfiles(self.files));
        });
    }

    if (ropts.reload) {
        self.populated = false;
    }
    if (self.populated && (!self.opts.cache_time ||
        self._update_time + self.opts.cache_time > Date.now())) {
        return cb(null, fstack_topfiles(self.files));
    }

    var opts2 = $.extend({}, opts);
    opts2.read = $.extend({}, ropts, {dirstate: self.dirstate,
        nitems: ropts.nitems, pgup: ropts.pgup});

    self.read(opts2, ef(cb, function(res) {
        to('text', res, {}, ef(cb, function(txt) {
            var data = parse_json(txt);
            if (!data) {
                return cb("JSON parsing error at " + self.ident);
            }
            self._update(data, opts);
            return makefiles(data);
        }));
    }));
};

Dir.prototype.update = function(meta, opts, cb) {
    var self = this,
        bdlmime = self.opts.bdl_mime,
        bdlmatch = bdlmime ? self.name.match(self.bdl_re) : false;

    if (!self._update(meta, opts)) {
        /* Short-circuit update of the stack here */
        return cb(null, fstack_top(self));
    }
    self.populated = false;
    if (bdlmime && bdlmatch) {
        assert("Dir.update.1", !self._ufile || self._ufile.mime === bdlmime, self);
        if (!self._ufile) {
            var meta2 = {ident: self.ident, name: self.name, fs: self.fs,
                mime: bdlmime};
            var mh = VFS.lookup_media_handler(bdlmime),
                mf = mh ? new mh.handler(meta2, mh.opts) : null;
            if (!mh) {
                return cb(null, self);
            }
            fstack_addtop(self, mf);
            return mf.update(meta, opts, cb);
        }
    }
    return File.prototype.update.call(self, meta, opts, cb);
};

Dir.prototype._update = function(meta, opts) {
    var self = this,
        changed = false;

    if (meta.cookie === undefined) {
        meta.cookie = self._get_cookie(meta);
    }
    if (self.cookie !== meta.cookie) {
        changed = true;
    }
    
    self._update_time = Date.now();
    mergeattr_x(self, meta, ["name", "ident", "fs", "mime", "populated",
        "files", "opts", "_update_time", "html"]);
    return changed;
};

/* unused */
Dir.prototype._get_cookie = function(data) {
    var siglist = data.files || [];
    siglist = siglist.map(function(f) {
        return f.name + f.size + f.mtime;
    });
    siglist.push(data.name + data.size + data.mtime);
    return siglist.sort().join('');
};

Dir.prototype.lookup = function(name, opts, cb) {
    var self = this;
    self.readdir(opts, ef(cb, function retblock(files) {
        if (name === '') { // '.', aka current directory
            return cb(null, fstack_top(self));
        }
        if (files[name]) {
            return cb(null, fstack_top(files[name]));
        } else {
            return cb(E('ENOENT'));
        }
   }));
};

Dir.prototype.unbundle = function(filename, data, opts, cb) {
    var self = this,
        obj = {},
        bdlname = filename + "." + self.opts.bdl_ext;

    self.mkdir(bdlname, opts, function(err, dir) {
        if (!err || err.code === 'EEXIST') {
            self.lookup(filename, opts, ef(cb, function(dir) {
                var pd = fstack_top(dir),
                    pb = fstack_base(dir);
                while (pd && pd.mime !== self.mime) {
                    pd = pd._lfile;
                }
                restoretree.call(pd, data, opts, ef(cb, function() {
                    /*
                     * Do a stat() to force the bundle to stack
                     * itself properly
                     */
                    fstack_top(pb).stat(opts, ef(cb, function() {
                        return cb(null, pb);
                    }));
                }));
            }));
        } else {
            return cb(err);
        }
    });
};

Dir.prototype.rm = function(filename, opts, cb) {
    var self = this;

    function rmbundle(file) {
        rmtree(file, opts, ef(cb, function() {
            self._lfile.rm(filename + "." + self.opts.bdl_ext, opts,
                ef(cb, function(res) {
                    self.populated = false;
                    return cb.apply(null, arguments);
                }));
        }));
    }

    self.lookup(filename, opts, ef(cb, function(file) {
        var l1 = fstack_level(file, 1),
            l2 = fstack_level(file, 2);

        if (l1 && l2 && l1.mime === self.mime &&
            l2.mime === self.opts.bdl_mime) {
            if (isrealdir(file)) {
                file.readdir(opts, ef(cb, function(files) {
                    if (Object.keys(files).length) {
                        return cb(E('ENOTEMPTY'));
                    }
                    return rmbundle(l1);
                }));
            } else {
                return rmbundle(l1);
            }
        } else {
            return self._lfile.rm(file.name, opts, ef(cb, function(res) {
                self.populated = false;
                return cb.apply(null, arguments);
            }));
        }
    }));
};

var Bundle = function(meta, opts) {
    this.mime = meta.mime || 'application/vnd.pigshell.bundle';
    Bundle.base.apply(this, arguments);
    this.populated = false;
    this.files = {};
};

inherit(Bundle, MediaHandler);

Bundle.prototype.update = function(meta, opts, cb) {
    var self = this,
        bdldir = self._lfile;

    /*
     * Hidden assumption: If update gets called, there must have been a change.
     * If we need to avoid this, maintain and check cookie/mtime
     */

    function ret(err) {
        //console.log('Bundle update: ' + err  + ': ' + self.name);
        fstack_rmbot(self);
        return cb(null, bdldir);
    }

    fstack_rmtop(self);
    self.files = {};
    self.populated = false;

    bdldir.readdir(opts, function(err, bdlfiles) {
        if (err) {
            return ret(err);
        }
        var metafile = fstack_base(bdlfiles['.meta']);
        if (!metafile) {
            return ret("No meta file");
        }
        metafile.read({'type': 'text', 'context': opts.context}, function(err, res) {
            if (err) {
                return ret(err);
            }
            var dotmeta = parse_json(res);
            if (!dotmeta || !dotmeta.meta) {
                return ret("Meta parsing error");
            }
            if (dotmeta.version && dotmeta.version !== '1.0') {
                return ret("Unsupported bundle version");
            }
            self.dotmeta = dotmeta;
            var meta = dotmeta.meta,
                ddata = dotmeta.data,
                mime = meta.mime;

            if (!mime) {
                return ret("No mime in meta");
            }

            var myfiles = $.extend({}, bdlfiles);

            delete myfiles['.meta'];
            delete myfiles['.rsrc'];
            if (ddata && ddata.type === 'file') {
                var fname = ddata.value;
                if (!bdlfiles[fname]) {
                    return ret("Data file missing in bundle dir");
                }
                delete myfiles[fname];
                ddata.value = fstack_base(bdlfiles[fname]);
            }

            self.files = myfiles;
            self.populated = true;
            var mh = VFS.lookup_media_handler(mime) ||
                VFS.lookup_media_handler('application/octet-stream');
            var mf = new mh.handler(self, meta);
            fstack_addtop(self, mf);
            return mf.update(meta, opts, cb);
        });
    });
};

Bundle.prototype.readdir = function(opts, cb) {
    var self = this;

    if (self.populated) {
        return cb(null, self.files);
    } else {
        self.stat(opts, ef(cb, function(res) {
            return res.readdir(opts, cb);
        }));
    }
};

Bundle.prototype.read = function(opts, cb) {
    var self = this,
        data = self.dotmeta.data,
        mime = self._ufile ? self._ufile.mime : 'application/octet-stream',
        retstring;

    if (!data) {
        return cb(E('ENODATA'));
    }
    if (data.type === 'file') {
        return data.value.read(opts, cb);
    }

    if (data.type === 'direct') {
        retstring = data.value;
    } else if (data.type === 'object') {
        retstring = JSON.stringify(data.value);
    } else {
        return cb("Unknown data type");
    }
    if (opts.type === 'text') {
        return cb(null, retstring);
    } else {
        var blob = new Blob([retstring], {type: mime});
        blob.href = self.ident;
        return cb(null, blob);
    }
};

["mkdir", "rm", "putdir", "link", "unbundle"].forEach(function(op) {
    Bundle.prototype[op] = fstack_invaldir_wrap(op);
});

VFS.register_handler("Dir", Dir);
VFS.register_handler("Bundle", Bundle);
VFS.register_media_handler("application/vnd.pigshell.dir", "Dir", {});
VFS.register_media_handler("application/vnd.pigshell.bundle", "Bundle", {});
