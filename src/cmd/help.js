/*
 * Copyright (C) 2012-2014 by Coriolis Technologies Pvt Ltd.
 * This program is free software - see the file COPYING for license details.
 */

function Help(opts) {
    var self = this;

    Help.base.call(self, opts);
}

inherit(Help, Command);

Help.prototype.usage = 'help         -- summary of available builtin commands\n\n' +
    'Usage:\n' +
    '    help [<cmd>]\n' +
    '    help [-h | --help]\n\n' +
    'Options:\n' +
    '    <cmd>        Show help for <cmd>\n' +
    '    -h --help    Show this message.\n';

Help.prototype.next = check_next(do_docopt(function() {
    var self = this,
        cmds = Command.list().sort(),
        cmdname = self.docopts['<cmd>'],
        usage,
        helpstr = [];

    function done() {
        self.done = true;
        return self.output(helpstr.join('\n') + '\n');
    }

    if (cmdname) {
        if (Command.lookup(cmdname) !== undefined) {
            self.done = true;
            return self.output(Command.lookup(cmdname).prototype.usage);
        } else {
            get_cmdhelp("/bin/" + cmdname, function(err, res) {
                if (err) {
                    return self.exit(err, res);
                }
                self.done = true;
                return self.output(res);
            });
            return;
        }
    }

    function get_cmdhelp(path, cb) {
        fread.call(self, path, function(err, res) {
            if (err) {
                return cb("Command not found", path);
            }
            to('text', res, {}, function(err, res) {
                if (err) {
                    return cb(err, path);
                }
                var helpstr = '';
                try {
                    var ast = parser.parse(res);
                    ast = ast.filter(function(a) { return a !== ""; });
                    if (ast[0] && ast[0]['ASSIGN'] && ast[0]['ASSIGN']['usage']) {
                        var o = ast[0]['ASSIGN']['usage'];
                        helpstr = o.SQUOTED_STRING || o.DQUOTED_STRING || o.HEREDOC || o.toString();
                    }
                } catch(e) {
                }
                if (helpstr) {
                    return cb(null, helpstr);
                } else {
                    return cb("No help found for " + path);
                }
            });
        });
    }

    helpstr.push('Builtin commands');
    helpstr.push('----------------');
    while ((cmdname = cmds.shift())) {
        var usage = Command.lookup(cmdname).prototype.usage,
            comps = (usage) ? usage.split('\n') : [];
        if (comps[0] && !comps[0].match(/usage:/i)) {
            helpstr.push(comps[0]);
        }
    }

    helpstr.push('\n');
    helpstr.push('Commands in /bin');
    helpstr.push('----------------');
    sys.search(self, '/bin/*', {}, function(err, res) {
        if (err) {
            return done();
        }
        async.forEachSeries(res, function(entry, acb) {
            get_cmdhelp("/bin/" + entry[0], function(err, res) {
                if (!err) {
                    var lines = res.split('\n'),
                        line = lines[0];
                    if (line === undefined) {
                        return acb(null);
                    }
                    helpstr.push(line);
                }
                return acb(null);
            });
        },
        function(err) {
            return done();
        });
    });
}));

Command.register('help', Help);
