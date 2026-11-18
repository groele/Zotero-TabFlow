var Zotero;
var startupGeneration = 0;
var activeRootURI = null;

async function startup({ id, version, rootURI }) {
	const generation = ++startupGeneration;
	await Zotero.initializationPromise;
	if (generation !== startupGeneration) return;
	try {
		activeRootURI = rootURI;
		Services.scriptloader.loadSubScript(rootURI + 'zoterotabflow.js');
		const tabflow = Zotero.zoterotabflow;
		tabflow.init({ id, version, rootURI });
		if (Zotero.ftl?.addResourceIds) {
			Zotero.ftl.addResourceIds(['zotero-tabflow.ftl']);
			tabflow._ftlRegistered = true;
		}
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + 'prefs.xhtml',
			scripts: [rootURI + 'zoterotabflow_prefs.js'],
			stylesheets: [rootURI + 'settings.css'],
			defaultXUL: true
		});
		tabflow.start();
	}
	catch (error) {
		shutdown();
		throw error;
	}
}

function shutdown(_data, reason) {
	startupGeneration++;
	const tabflow = Zotero?.zoterotabflow;
	try {
		tabflow?.shutdown();
	}
	catch (error) {
		Zotero?.logError?.(error);
	}
	finally {
		try {
			if (tabflow?._ftlRegistered) {
				Zotero.ftl?.removeResourceIds?.(['zotero-tabflow.ftl']);
			}
		}
		catch (error) {
			Zotero?.logError?.(error);
		}
		finally {
			if (Zotero) delete Zotero.zoterotabflow;
			const appShutdown = typeof APP_SHUTDOWN !== 'undefined' && reason === APP_SHUTDOWN;
			if (!appShutdown) {
				try {
					if (activeRootURI && typeof Cu !== 'undefined') Cu.unload(activeRootURI + 'zoterotabflow.js');
				}
				catch (error) {
					Zotero?.logError?.(error);
				}
				try {
					if (typeof Cc !== 'undefined' && typeof Ci !== 'undefined') {
						Cc['@mozilla.org/intl/stringbundle;1'].getService(Ci.nsIStringBundleService).flushBundles();
					}
				}
				catch (error) {
					Zotero?.logError?.(error);
				}
				try {
					if (typeof ADDON_DISABLE !== 'undefined' && reason === ADDON_DISABLE) {
						Services.obs.notifyObservers(null, 'startupcache-invalidate', null);
					}
				}
				catch (error) {
					Zotero?.logError?.(error);
				}
			}
			activeRootURI = null;
		}
	}
}

function onMainWindowLoad({ window }) {
	Zotero?.zoterotabflow?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Zotero?.zoterotabflow?.onMainWindowUnload(window);
}

function install() {}
function uninstall() {}
