/*
 * Copyright (C) 2012-2014 by Coriolis Technologies Pvt Ltd.
 * This program is free software - see the file COPYING for license details.
 *
 * A generic OAuth2 client based on
 * https://github.com/timdream/google-oauth2-web-client and
 * http://adodson.com/hello.js/
 *
 * We need to extend the former for multiple OAuth2 users, with hints from the
 * latter regarding quirks of various providers.
 *
 * This file is shared across multiple releases, so it should be modified with
 * great care, keeping in mind backward compatibility with all the releases
 * which use it. One of the ways we do this is to keep it standalone - not
 * dependent on any external libraries like jQuery.
 */

/**
 * @param {string} options.url - OAuth2 endpoint URL
 * @param {number} [options.timeout] - Timeout for auth dialog
 * @param {string} [options.display] - "iframe", "popup"
 * @param {number} [options.popupWidth]
 * @param {number} [options.popupHeight]
 * @param {Object} options.oauth2 - OAuth2 parameters
 * @param {string} options.oauth2.client_id
 * @param {string} [options.oauth2.scope]
 * @param {string} options.oauth2.redirect_uri
 * @param {string[]} opts.scope - List of scopes
 * @param {boolean} opts.force - Force reauthentication
 */

function OAuth2(options) {
    this.options = {};
    var oauth2 = options.oauth2;
    if (!options || !oauth2 || !options.url || !options.display) {
        throw "options not set";
    }
    this.oauth2 = oauth2;
    if (!oauth2.client_id) {
        throw "client_id must be set";
    }
    oauth2.response_type = "token";
    this.popupWidth = options.popupWidth || 500;
    this.popupHeight = options.popupHeight || 400;
    this.timeout = options.timeout || 60;
    this.display = options.display || "iframe";
    this.url = options.url;
    this.onlogin = this.popup = this.iframe = this.timer = null;
    this.name = "oauth2-win";
}

OAuth2.prototype.recvmsg = function(event) {
    var self = this;

    if (event.origin !== "http://" + window.location.hostname &&
        event.origin !== "https://" + window.location.hostname) {
        return;
    }
    var msg = event.data;
    if (!msg || (msg.hash === undefined || msg.search === undefined ||
        !msg.name || msg.name !== self.name)) {
        return;
    }
    var hp = parseqs(msg.hash.slice(1)),
        sp = parseqs(msg.search.slice(1)),
        res;

    self.cleanup();

    if (!hp.access_token && !hp.error && !sp.error) {
        console.log("Unknown message: ", msg);
        res = {error: "Unknown"};
    } else if (sp.error) {
        res = sp;
    } else if (hp.error) {
        res = hp;
    } else if (hp.state !== self.state) {
        res = {error: "State mismatch"};
    } else {
        res = hp;
    }
    if (self.onlogin) {
        self.onlogin(res.error || null, res);
    } else {
        console.log("onlogin not set!");
    }
};

function makeqs(opts) {
    var str = [];
    for (var o in opts) {
        if (opts.hasOwnProperty(o)) {
            str.push(encodeURIComponent(o) + '=' + encodeURIComponent(opts[o]));
        }
    }
    return str.join('&');
}

function parseqs(str) {
    var qp = str.split('&'),
        params = {};

    qp.forEach(function(el) {
        var pv = el.split('=');
        if (pv.length === 2) {
            params[pv[0]] = pv[1];
        }
    });
    return params;
}

OAuth2.prototype.login = function(cb) {
    var self = this;
    self.state = Math.random().toString(36).substr(2);
    self.oauth2.state = self.state;
    self.name = window.location.protocol + self.name + self.state;
    var qs = makeqs(self.oauth2),
        url = self.url + '?' + qs;

    self.listener = self.recvmsg.bind(self);
    window.addEventListener("message", self.listener, false);
    self.timer = setTimeout(function() {
        self.cleanup();
        return cb({error: "Timed out"});
    }, self.timeout * 1000);

    self.onlogin = cb;
    if (self.display === "iframe") {
        var iframe = self.iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.hidden = true;
        iframe.width = iframe.height = 1;
        iframe.name = self.name;
        document.body.appendChild(iframe);
        return;
    }
    var left = window.screenX + (window.outerWidth / 2) -
        (self.popupWidth / 2),
        top = window.screenY + (window.outerHeight / 2) -
        (self.popupHeight / 2),
        features = 'width=' + self.popupWidth +
                   ',height=' + self.popupHeight +
                   ',top=' + top +
                   ',left=' + left +
                   ',location=yes,toolbar=no,menubar=no';
    self.popup = window.open(url, self.name, features);
    if (!self.popup) {
        self.cleanup();
        return cb("Popup blocked");
    }
};

OAuth2.prototype.cleanup = function() {
    var self = this;

    if (self.iframe) {
        document.body.removeChild(self.iframe);
        self.iframe = null;
    }
    if (self.popup) {
        self.popup.close();
        self.popup = null;
    }
    if (self.timer) {
        clearTimeout(self.timer);
        self.timer = null;
    }
    if (self.listener) {
        window.removeEventListener("message", self.listener, false);
    }
};

function sendmsg() {
    var opener = window.opener || window.parent;

    if (!opener) {
        console.log("Could not find opener?!");
        return;
    }
    var msg = {
        name: window.name || '',
        search: window.location.search || '',
        hash: window.location.hash || ''
    },
    proto = window.name.match(/^(http[s]?:)/)[1];
    opener.postMessage(msg, proto + "//" + window.location.hostname);
}


if (window.name.match(/^http[s]?:oauth2-win/)) {
    sendmsg();
}
