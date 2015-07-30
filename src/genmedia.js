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

var Dir = function() {
    Dir.base.apply(this, arguments);
    this.files = {};
    this.populated = false;
    this.mime = this.fs.dirmime || 'application/vnd.pigshell.dir+json';
    
    var bdlmatch = this.name.match(/(.*)\.bdl$/),
        name = bdlmatch ? bdlmatch[1] : this.name;
    this.html = sprintf('<div class="pfolder"><a href="%s" target="_blank">%s</a></div>', this.ident, name);
    this.cookie = -1;
};

inherit(Dir, MediaHandler);

["mkdir", "rm", "putdir", "link"].forEach(function(op) {
    Dir.prototype[op] = fstack_invaldir_wrap(op);
});

Dir.prototype.readdir = function(opts, cb) {
    var self = this,
        dirmime = self.fs.dirmime || 'application/vnd.pigshell.dir+json',
        bdlmime = self.fs.bdlmime;

    function makefiles(data) {
        if (self.populated) {
            return cb(null, fstack_topfiles(self.files));
        }

        var flist = [],
            base = URI.parse(self.redirect_url || self.ident),
            bfiles = self.files,
            bdls = [],
            bdlseen = {};
            
        if (bdlmime) {
            /* Bdls win any aliasing contest */
            data.files.forEach(function(el) {
                var bdlmatch = (el.mime === dirmime) ?
                    el.name.match(/(.*)\.bdl$/) : null;
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
                bdlmatch = (bdlmime && el.mime === dirmime) ?
                    el.name.match(/(.*)\.bdl$/) : null,
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

    if (self.fs.opts.cachedir && self.populated) {
        return cb(null, fstack_topfiles(self.files));
    }
    self.read(opts, ef(cb, function(res) {
        to('text', res, {}, ef(cb, function(txt) {
            var data = parse_json(txt);
            if (!data) {
                return cb("JSON parsing error at " + self.ident);
            }
            if (!(opts.readdir && opts.readdir.noupdate)) {
            /*
                fstack_base(self).update(data, opts, ef(cb, function(res) {
                    var b = fstack_base(res);
                    while (b) {
                        if (b === self) {
                            return makefiles(data);
                        }
                        b = b._ufile;
                    }
                    console.log("Dir WTF");
                    return res.readdir(opts, cb);
                }));
            */
                self.update(data, opts, ef(cb, function(res) {
                    return makefiles(data);
                }));
            } else {
                self._update(data, opts);
                return makefiles(data);
            }
        }));
    }));
};

Dir.prototype.update = function(meta, opts, cb) {
    var self = this,
        bdlmatch = self.name.match(/(.*)\.bdl$/),
        bdlmime = self.fs.bdlmime;

    if (!self._update(meta, opts)) {
        /* Short-circuit update of the stack here */
        return cb(null, fstack_top(self));
    }
    self.populated = false;
    if (bdlmime && bdlmatch) {

        assert("Dir.update.1", !self._ufile || self._ufile.mime === bdlmime, self);
        if (!self._ufile) {
            var mh = VFS.lookup_media_handler(bdlmime),
                mf = mh ? new mh.handler(self) : null;
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
    
    mergeattr_x(self, meta, ["name", "ident", "fs", "mime", "populated", "files"]);
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

Dir.prototype.unbundle = function(filename, data, opts, cb) {
    var self = this,
        obj = {};

    self.mkdir(filename + '.bdl', opts, function(err, dir) {
        if (!err || err.code === 'EEXIST') {
            self.lookup(filename, opts, ef(cb, function(dir) {
                var pd = fstack_top(dir),
                    pb = fstack_base(dir);
                while (pd && pd.mime !== self.mime) {
                    pd = pd._lfile;
                }
                restoretree.call(pd, data, opts, ef(cb, function() {
                    return cb(null, pb);
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
        var opts2 = $.extend({}, opts);
        opts2.readdir = { noupdate: true };
        rmtree(file, opts2, ef(cb, function() {
            self._lfile.rm(filename + '.bdl', opts, cb);
        }));
    }

    self.lookup(filename, opts, ef(cb, function(file) {
        var l1 = fstack_level(file, 1),
            l2 = fstack_level(file, 2);

        if (l1 && l2 && l1.mime === self.fs.dirmime &&
            l2.mime === self.fs.bdlmime) {
            if (isrealdir(file)) {
                var opts2 = $.extend({}, opts);
                opts2.readdir = { noupdate: true };
                file.readdir(opts2, ef(cb, function(files) {
                    if (Object.keys(files).length) {
                        return cb(E('ENOTEMPTY'));
                    }
                    return rmbundle(l1);
                }));
            } else {
                return rmbundle(l1);
            }
        } else {
            return self._lfile.rm(file.name, opts, cb);
        }
    }));
};

var Bundle = function(file) {
    Bundle.base.apply(this, arguments);
    this.mime = this.fs.bdlmime || 'application/vnd.pigshell.bundle+json';
    this.populated = false;
    this.files = {};
};

inherit(Bundle, MediaHandler);

Bundle.prototype.update = function(meta, opts, cb) {
    var self = this,
        bdldir = self._lfile,
        opts2 = $.extend({}, opts);

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

    opts2.readdir = { noupdate: true };
    bdldir.readdir(opts2, function(err, bdlfiles) {
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

Bundle.prototype.getdata = function(opts, cb) {
    var self = this,
        data = self.dotmeta.data,
        mime = self._ufile ? self._ufile.mime : 'application/octet-stream',
        retstring;

    if (!data) {
        return cb(E('ENODATA'));
    }
    if (data.type === 'file') {
        return data.value.getdata(opts, cb);
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

Bundle.prototype.read = Bundle.prototype.getdata;

["mkdir", "rm", "putdir", "link", "unbundle"].forEach(function(op) {
    Bundle.prototype[op] = fstack_invaldir_wrap(op);
});

VFS.register_handler("Dir", Dir);
VFS.register_handler("Bundle", Bundle);
VFS.register_media_handler("application/vnd.pigshell.dir+json", "Dir", {});
VFS.register_media_handler("application/vnd.pigshell.bundle+json", "Bundle", {});
