/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
var Template = require("./Template");

function JsonpMainTemplatePlugin() {
}
module.exports = JsonpMainTemplatePlugin;

JsonpMainTemplatePlugin.prototype.constructor = JsonpMainTemplatePlugin;
JsonpMainTemplatePlugin.prototype.apply = function(mainTemplate) {
	mainTemplate.plugin("local-vars", function(source, chunk, hash) {
		if(chunk.chunks.length > 0) {
			return this.asString([
				source,
				"",
				"// object to store loaded and loading chunks",
				'// "0" means "already loaded"',
				'// Array means "loading", array contains callbacks',
				"var installedChunks = {",
				this.indent(
					chunk.ids.map(function(id) {
						return id + ":0"
					}).join(",\n")
				),
				"};"
			]);
		}
		return source;
	});
	mainTemplate.plugin("require-ensure", function(_, chunk, hash) {
		var filename = this.outputOptions.filename || "bundle.js";
		var chunkFilename = this.outputOptions.chunkFilename || "[id]." + filename;
		var chunkHashMap = {};
		var chunkNameMap = {};
		(function addChunk(c) {
			if(c.id in chunkHashMap) return;
			if(c.entry)
				chunkHashMap[c.id] = undefined;
			else
				chunkHashMap[c.id] = c.renderedHash;
			chunkNameMap[c.id] = c.name || undefined;
			c.chunks.forEach(addChunk);
		}(chunk));
		return this.asString([
			"// \"0\" is the signal for \"already loaded\"",
			"if(installedChunks[chunkId] === 0)",
			this.indent("return callback.call(null, " + this.requireFn + ");"),
			"",
			"// an array means \"currently loading\".",
			"if(installedChunks[chunkId] !== undefined) {",
			this.indent("installedChunks[chunkId].push(callback);"),
			"} else {",
			this.indent([
				"// start chunk loading",
				"installedChunks[chunkId] = [callback];",
				"var head = document.getElementsByTagName('head')[0];",
				"var script = document.createElement('script');",
				"script.type = 'text/javascript';",
				"script.charset = 'utf-8';",
				"script.src = " + this.requireFn + ".p + " +
					JSON.stringify(chunkFilename)
					.replace(Template.REGEXP_HASH, "\" + " + this.renderCurrentHashCode(hash) + " + \"")
					.replace(Template.REGEXP_CHUNKHASH, "\" + " + JSON.stringify(chunkHashMap) + "[chunkId] + \"")
					.replace(Template.REGEXP_NAME, "\" + (" + JSON.stringify(chunkNameMap) + "[chunkId]||chunkId) + \"")
					.replace(Template.REGEXP_ID, "\" + chunkId + \"") + ";",
				"head.appendChild(script);"
			]),
			"}"
		]);
	});
	mainTemplate.plugin("bootstrap", function(source, chunk, hash) {
		if(chunk.chunks.length > 0) {
			var jsonpFunction = this.outputOptions.jsonpFunction || Template.toIdentifier("webpackJsonp" + (this.outputOptions.library || ""));
			return this.asString([
				source,
				"",
				"// install a JSONP callback for chunk loading",
				"var parentJsonpFunction = window[" + JSON.stringify(jsonpFunction) + "];",
				"window[" + JSON.stringify(jsonpFunction) + "] = function webpackJsonpCallback(chunkIds, moreModules) {",
				this.indent([
					'// add "moreModules" to the modules object,',
					'// then flag all "chunkIds" as loaded and fire callback',
					"var moduleId, chunkId, i = 0, callbacks = [];",
					"for(;i < chunkIds.length; i++) {",
					this.indent([
						"chunkId = chunkIds[i];",
						"if(installedChunks[chunkId])",
						this.indent("callbacks.push.apply(callbacks, installedChunks[chunkId]);"),
						"installedChunks[chunkId] = 0;"
					]),
					"}",
					"for(moduleId in moreModules) {",
					this.indent(this.renderAddModule(hash, chunk, "moduleId", "moreModules[moduleId]")),
					"}",
					"if(parentJsonpFunction) parentJsonpFunction(chunkIds, moreModules);",
					"while(callbacks.length)",
					this.indent("callbacks.shift().call(null, " + this.requireFn + ");"),
					(this.entryPointInChildren(chunk) ? [
						"if(moreModules[0]) {",
						this.indent([
							"installedModules[0] = 0;",
							this.requireFn + "(0);"
						]),
						"}"
					] : "")
				]),
				"};"
			]);
		}
		return source;
	});
	mainTemplate.plugin("hot-bootstrap", function(source, chunk, hash) {
		var hotUpdateChunkFilename = this.outputOptions.hotUpdateChunkFilename;
		var hotUpdateMainFilename = this.outputOptions.hotUpdateMainFilename;
		var hotUpdateFunction = this.outputOptions.hotUpdateFunction || Template.toIdentifier("webpackHotUpdate" + (this.outputOptions.library || ""));
		var currentHotUpdateChunkFilename = JSON.stringify(hotUpdateChunkFilename)
			.replace(Template.REGEXP_HASH, "\" + " + this.renderCurrentHashCode(hash) + " + \"")
			.replace(Template.REGEXP_ID, "\" + chunkId + \"");
		var currentHotUpdateMainFilename = JSON.stringify(hotUpdateMainFilename)
			.replace(Template.REGEXP_HASH, "\" + " + this.renderCurrentHashCode(hash) + " + \"");
		return source + "\nthis[" + JSON.stringify(hotUpdateFunction) + "] = " + Template.getFunctionContent(function() {
			function webpackHotUpdateCallback(chunkId, moreModules) {
				hotAddUpdateChunk(chunkId, moreModules);
			}

			function hotDownloadUpdateChunk(chunkId) {
				var head = document.getElementsByTagName('head')[0];
				var script = document.createElement('script');
				script.type = 'text/javascript';
				script.charset = 'utf-8';
				script.src = $require$.p + $hotChunkFilename$;
				head.appendChild(script);
			}

			function hotDownloadManifest(callback) {
				if(typeof XMLHttpRequest === "undefined")
					return callback(new Error("No browser support"));
				try {
					var request = new XMLHttpRequest();
					request.open("GET", $require$.p + $hotMainFilename$, true);
					request.send(null);
				} catch(err) {
					return callback(err);
				}
				request.onreadystatechange = function() {
					if(request.readyState !== 4) return;
					if(request.status !== 200 && request.status !== 304) {
						callback();
					} else {
						try {
							var update = JSON.parse(request.responseText);
						} catch(e) {
							callback();
							return;
						}
						callback(null, update);
					}
				};
			}
		})
			.replace(/\$require\$/g, this.requireFn)
			.replace(/\$hotMainFilename\$/g, currentHotUpdateMainFilename)
			.replace(/\$hotChunkFilename\$/g, currentHotUpdateChunkFilename)
			.replace(/\$hash\$/g, JSON.stringify(hash))
	});
	mainTemplate.plugin("hash", function(hash) {
		hash.update("jsonp");
		hash.update("4");
		hash.update(this.outputOptions.filename + "");
		hash.update(this.outputOptions.chunkFilename + "");
		hash.update(this.outputOptions.jsonpFunction + "");
		hash.update(this.outputOptions.library + "");
	});
};
