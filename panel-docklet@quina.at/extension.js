/* * * * * * * * * * * *\
 *    Panel-Docklet    *
 * Jodli  (pw3@gmx.at) *
\* * * * * * * * * * * */

/*\
 * NOTES:
 * 
 * (possible?) window-preferences (foreground, ...)
 * drag-over-hover-menu doesnt change on window-change
 * vertical window-list? How in popup-Menu? (rewrite!)
 * tray-right-click-menu is behind the docklet (gnome-shell bug? )
 * shell-reload with minimized windows -> minimized-check of windows is false...
 * intelligent workspace-navigator
 * workspace-navigator with window-icons (?)
 * change order of favorites
 * extras: tray-menu, time - right side?
\*/


//script assumes, that no version 4.0 exists!
const ShellVersion = imports.misc.config.PACKAGE_VERSION.split(".");

const St = imports.gi.St;
const Main = imports.ui.main;
const LayoutManager = Main.layoutManager;
const Shell = imports.gi.Shell;
const Lang = imports.lang;
const Tweener = imports.ui.tweener;
const DND = imports.ui.dnd;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const AppFavorites = imports.ui.appFavorites;
const AppDisplay = imports.ui.appDisplay;
const PopupMenu = imports.ui.popupMenu;
const ModalDialog = imports.ui.modalDialog;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;

const Extention_path = (ShellVersion[1]<4) ? imports.ui.extensionSystem.extensionMeta["panel-docklet@quina.at"].path : imports.misc.extensionUtils.getCurrentExtension().path;
const Gettext = imports.gettext;
const _ = Gettext.gettext;

const MINIMIZE_WINDOW=0;
const NEW_WINDOW=1;
const CLOSE_WINDOW=2;
const QUIT_APP=3;

const FIXED_LEFT = 0;
const FIXED_MIDDLE = 1;
const FIXED_RIGHT = 2;

/*structure:
 * left/right is only checked where x, y, width, height are set.
 * _COMF_dockY==LEFT||RIGHT -> doesnt exist. Only _CONF_rotated == true||false influences vertical positioning
 * script and variable-names dont expect left/right
 * so: LEFT == TOP and RIGHT == BOTTOM
 */

const BELOW_PANEL = 0;
const TOP = 1;
const BOTTOM = 2;
const LEFT = 3;
const RIGHT = 4;

const ROTATION_MARK = 2;

const AUTO = 0;
const ALWAYS = 1;
const NEVER = 2;

const STATE = {
	REMOVED: 0,
	GETS_REMOVED: 1,
	INSERTED: 2
};

const GROUP_PADDING_BOTTOM = 2; //will be used as top-Position for window-icons if dockY == BOTTOM
const GROUP_PADDING_LEFT = 5;
const GROUP_PADDING_RIGHT = 5;
const TRAY_BUTTON_SIZE = 16;
const MESSAGE_TRAY_DEAD_ZONE = 100;
const MESSAGE_TRAY_NEEDED_ZONE = 400;
const WS_LABEL_FONT_SIZE = 10;
const WS_LABEL_WIDTH = 20;
const WS_NAVIGATOR_SPACE = 1;
const WS_NAVIGATOR_PADDING_Y = 4;
const WS_NAVIGATOR_PADDING_LEFT = 3;
const WS_LINES_SPACE_BETWEEN = 5;
const WS_LINES_SPACE_LEFT = 4;
const ICON_PADDING_TOP = 3;
const ICON_PADDING_SUM = 6;
const ICON_MINIMIZED_OPACITY = 125;
const ICON_COPY_OPACITY = 75;
const ICON_LABEL_SPACE = 2;
const BUTTON_MAX_WIDTH = 200;
const PREVIEW_RIGHT_CLICK_HEIGHT = 250;
const PREVIEW_HOVER_HEIGHT = 150;
const MOUSE_POLL_FREQUENCY = 50;

//Why are functions renames without creating a deprecated pointer..?
//Workaround...
const cleanActor = (ShellVersion[1]<4) ? function(o) {return o.destroy_children();} : function(o) {return o.destroy_all_children();};

let mainPanelDocklet, secondaryPanelDocklets = [], ID_monitorEvent=false;


function SettingsContainer(Extention_path, id) {
	this._init(Extention_path, id);
}
SettingsContainer.prototype = {
	_init: function(Extention_path, id) {
		this._connector = {};
		
		this._conf = {};
		this.set_boolean = this._take_data;
		this.set_double = this._take_data;
		this.set_int = this._take_data;
		this.set_enum = this._take_data;
		
		//in theory, id could be a great security leak. But extentions already have file-system-rights anyway...
		this._file = Gio.file_new_for_path(Extention_path + "/settings"+id+".json");
		
		if(this._file.query_exists(null)) {
			[flag, data] = this._file.load_contents(null);
			
			if(flag)
				this._conf = JSON.parse(data);
			else {
				global.log("Panel-Docklet: Something's wrong... I wasn't able to load the settings... I'll ignore that and get you the default-settings instead.");
				this.restoreDefault(Extention_path);
			}
			//no error: I want to be able to save it anyway
			this._error = false;
		}
		else {
			global.log("Panel-Docklet: Uh, there are no settings saved for that Box. I'll get you the default settings instead.");
			this.restoreDefault(Extention_path);
		}
	},
	
	get_boolean: function(k) {
		return this._conf[k] || false;
	},
	get_double: function(k) {
		return this._conf[k] || 0;
	},
	get_int: function(k) {
		return parseInt(this._conf[k]);
	},
	get_enum: function(k) {
		return this._conf[k] || 0;
	},
	
	_take_data: function(k, v, noEmit) {
		this._conf[k] = v;
		if(!noEmit) {
			this.save_data();
			this.emit(k);
		}
	},
	
	restoreDefault: function(Extention_path) {
		this._conf = {};
		
		let file = Gio.file_new_for_path(Extention_path + "/default.json");
		if(file.query_exists(null)) {
			[flag, data] = file.load_contents(null);
			if(flag) {
				this._conf = JSON.parse(data);
				this._error = false;
			}
			else {
				global.log("Panel-Docklet: Something's terribly wrong! I wasn't able to load the default settings... I won't save anything in this session. And don't blame me, if Panel-Docklet is acting strangely...");
				this._error = true;
			}
		}
		else {
			global.log("Panel-Docklet: Something's terribly wrong! Neither your settings nor the default settings seem to exist... I won't save anything in this session. And don't blame me, if Panel-Docklet is acting strangely...");
			this._error = true;
		}
		this.save_data();
	},
	_restore_backup: function(b) {
		this._conf = b;
		this.save_data();
	},
	save_data: function() {
		if(!this._error)
			this._file.replace_contents(JSON.stringify(this._conf), null, false, 0, null);
		else
			global.log("Panel-Docklet: I really want to save that. But there was an error before...");
	},
	_get_backup: function() {
		let copy={};
		for(let k in this._conf) {
			copy[k] = this._conf[k];
		};
		return copy;
	},
	
	
	connect: function(k, f) {
		this._connector[k] = f;
	},
	disconnect: function(k) {
		delete this._connector[k];
	},
	emit: function(k) {
		if(this._connector[k])
			this._connector[k](k, this._conf[k]);
	}
}

function FavWindow(app, dock, ws) {
	this._init(app, dock, ws);
}
FavWindow.prototype = {
	_init: function(app, dock, ws) {
		this._dock = dock;
		this._myApp = app;
		this._myWorkspace = ws;
		this.justA_favWindow = true;
		
		this.title = app.get_name();
		this.minimized = (this._myApp.state == Shell.AppState.STOPPED);
		
		this._ID_stateChanged = this._myApp.connect('notify::state', Lang.bind(this, this._onStateChanged));
		
		//empty window-functions:
		this.connect = this.disconnect = this.minimize = this.delete = this.change_workspace_by_index = function() {};
	},
	_onStateChanged: function() {
		let icon = this[this._dock._WIN_VAR_KEY_icon];
		if(this._myApp.state != Shell.AppState.STOPPED) {
			this.minimized = false;
			if(icon)
				icon.showMaped();
		}
		else {
			this.minimized = true;
			//Workaround: window-closed-connector is called after app has stopped... Thanks for that...
			Mainloop.timeout_add(100, Lang.bind(this, function() {if(icon) icon.showMinimized();}));
		}
	},
	
	is_on_all_workspaces: function() {
		return false;
	},
	has_focus: function() {
		return false;
	},
	
	activate: function() {
		this._myApp.open_new_window(this._dock._box._currentWS);
	},
	get_workspace: function() {
		return this._myWorkspace;
	},
	
	_destroy: function() {
		this._myApp.disconnect(this._ID_stateChanged);
	}
}


function panelDocklet(id, secondaryPanelDocklets) {
	this._init(id, secondaryPanelDocklets);
}
panelDocklet.prototype = {
	_init: function(id, secondaryPanelDocklets) {
		this._monitorId = id;
		this._realMonitorId = ((id == "primary") ? LayoutManager.primaryIndex : id);
		this._secondaryPanelDocklets = secondaryPanelDocklets;
		this._WIN_VAR_KEY_icon = "PANEL_DOCKLET_icon"+id;
		
		this._winLenRecord = 0;
		this._winLenRecordClass = null;
		
		this._menu = false;
		this._settingsMenu = false;
		
		this._lastZoomWS = null;
		this._ID_mouseTracking = false;
		
		
		let settings =	new SettingsContainer(Extention_path, id);
		this.settings = settings;
		
		this._loadConfigs("all");
		this.xy = this._CONF_rotated ? this._y : this._x;
		
		
		this.actorBox = new (this._CONF_rotated ? Y_ActorBox : X_ActorBox)(this);
		this.actor = this.actorBox.actor;
		
		this._box = new workspaceBox(this);
		this.actorBox._createExtras();//after _wsbg hast been created
		this._box._indexAllWS();
		
		if(this._CONF_cutStruts)
			this._addStrut();
		
		this._dragPointer = new St.Bin({style_class: "moveTo"});
		
		this._windowList_current = false;
		this._windowList_timeout = false;
		//this._windowList = new PopupMenu.PopupComboMenu();
		this._windowList = new PopupMenu.PopupMenuSection(this);
		//this._windowList = new AppDisplay.AppIconMenu(this);
		this._windowList.actor.set_style_class_name("panelDocklet_windowList");
		this._windowList.actor.reactive = true;
		this._windowList.actor.hide();
		LayoutManager.addChrome(this._windowList.actor);
		
		
		if(this._CONF_hoverIcons) {
			//enterEvent is managed in windowIcons
			this._ID_list_leaveEvent = this._windowList.actor.connect("leave-event", Lang.bind(this, this._check_hideWindowList));
			this._ID_list_icon_leaveEvent = this.actor.connect("leave-event", Lang.bind(this, this._check_hideWindowList));
			if(this._CONF_autohide)
				this._ID_list_hide_leaveEvent = this._windowList.actor.connect("leave-event", Lang.bind(this.actorBox, this.actorBox._check_hideDock));
			
			this._ID_activate = this._windowList.connect("activate", Lang.bind(this, function(actor, child) {
					if(child && child._myWindow) {
						let win = child._myWindow;
						if(win.has_focus())
							win.minimize();
						else {
							let ws = win.get_workspace();
							if(ws == null) //if window was closed while menu was open
								return
							else if(ws != global.screen.get_active_workspace())
								ws.activate(global.get_current_time());
							win.activate(global.get_current_time());
						}
						this.hideWindowList();
					}
				}));
			this._ID_xdnd_dragEnd_list = Main.xdndHandler.connect('drag-end', Lang.bind(this, this.hideWindowList));
		}
		
		
	
		
		if(this._is_trayButton_needed())
			this._addTrayButton();
		
		
		
		if(this._CONF_autohide)
			this.actorBox._hideDock();
		else if(this._CONF_showAllWS)
			this.actorBox.listWS(); //has to be after workspaces are indexed
		
		if(this._CONF_windowFavs)
			this._ID_favUpdate = AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._reload));
		else if(this._CONF_smallFavs)
			this._ID_favUpdate = AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._update_extras));
		
		this._ID_attention = global.display.connect('window-demands-attention', Lang.bind(this, this._onWindowDemandsAttention));
		
		settings.connect("show-window-texture", Lang.bind(this, this._loadConfigs));
		settings.connect("show-window-list", Lang.bind(this, this._loadConfigs));
		settings.connect("autohide", Lang.bind(this, function(k, v) {
				if((this._CONF_autohide = v)) {
					if(!this.actorBox._ID_enterEvent) {
						this.actorBox._ID_xdnd_dragBegin = Main.xdndHandler.connect('drag-begin', Lang.bind(this.actorBox, this.actorBox._showDock));
						this.actorBox._ID_xdnd_dragEnd_hide = Main.xdndHandler.connect('drag-end', Lang.bind(this.actorBox, this.actorBox._hideDock));
						this.actorBox._ID_enterEvent = this.actor.connect("enter-event", Lang.bind(this.actorBox, this.actorBox._check_showDock));
						this.actorBox._ID_leaveEvent = this.actor.connect("leave-event", Lang.bind(this.actorBox, this.actorBox._check_hideDock));
						this.actorBox._addPanelEvents();
						this._DATA_opacTo = this._CONF_hideToOpacity;
						this.actorBox._hideDock();
						if(this._CONF_hoverIcons)
							this._ID_list_hide_leaveEvent = this._windowList.actor.connect("leave-event", Lang.bind(this.actorBox, this.actorBox._check_hideDock));
					}
					if(this._CONF_moveTrayLine)
						LayoutManager.trayBox.set_y(this._hideTo);
					
					let wsBox = this._box,
						ws = wsBox._workspaces,
						i = ws.length,
						wins, j;
						
						while(i--) {
							wins = ws[i];
							j = wins._windows.length;
							wins.shownWindows = 0;
							while(j--) {
								wins.inc_shownWindows();
							}
						}
				}
				else {
					if(this.actorBox._ID_enterEvent) {
						this.actor.disconnect(this.actorBox._ID_enterEvent);
						this.actor.disconnect(this.actorBox._ID_leaveEvent);
						this.actorBox._ID_enterEvent = false;
					}
					this.actorBox._removePanelEvents();
					this._DATA_opacTo = 255;
					this.actorBox._showDock();
					
					if(this._CONF_moveTrayLine)
						LayoutManager.trayBox.set_y(this._dockY);
					if(this._ID_list_hide_leaveEvent)
						this._windowList.actor.disconnect(this._ID_list_hide_leaveEvent);
				}
				
				if(this._CONF_cutStruts) {
					let y = this._getStrutVars();
					this._strut_y(y[0]);
					this._strut_height(y[1]);
				}
			}));
		settings.connect("hide-to-opacity", Lang.bind(this, function(k, v) {
				this._CONF_hideToOpacity = v;
				if(this._CONF_autohide) {
					this._DATA_opacTo = v;
				
					if(this.actorBox._isHidden)
						this.actor.opacity = v;
				}
			}));
		settings.connect("dont-hide-size", Lang.bind(this, function(k, v) {
				this._CONF_dontHideSize = v;
				this._hideTo = (this._CONF_dockY_type == BOTTOM) ? this._dockY + (this._dockInnerHeight - this._CONF_dontHideSize) : this._dockY + this._CONF_dontHideSize - this._CONF_iconSize;
				
				if(this._CONF_autohide) {
					this.actorBox._isHidden = false;
					this.actorBox._hideDock();
					
					if(this._CONF_moveTrayLine)
						LayoutManager.trayBox.set_y(this._hideTo);
				}
				else if(this._CONF_moveTrayLine)
					LayoutManager.trayBox.set_y(this._dockY);
				
				if(this._CONF_cutStruts) {
					let y = this._getStrutVars();
					
					this._strut_y(y[0]);
					this._strut_height(y[1]);
				}
			}));
		settings.connect("cut-view", Lang.bind(this, function(k,v) {
				if((this._CONF_cutStruts = v)) {
					if(this._cutStrut)
						this._cutStrut.destroy();
					this._addStrut();
				}
				else if(this._cutStrut) {
					this._cutStrut.destroy();
					this._cutStrut = false;
				}
			}));
		settings.connect("strut-space", Lang.bind(this, function(k,v) {
				this._CONF_strutSpace = v;
				let t = this._getStrutVars();
				this._strut_y(t[0]);
				this._strut_height(t[1]);
			}));
		
		settings.connect("show-workspace-number", Lang.bind(this, this._update_extras));
		settings.connect("show-workspace-navigator", Lang.bind(this, this._update_extras));
		settings.connect("workspace-navigators-num", Lang.bind(this, this._update_extras));
		settings.connect("show-desktop-button", Lang.bind(this, this._update_extras));
		settings.connect("create-tray-button", Lang.bind(this, function(k, v) {
				this._loadConfigs(); //because of _CONF_moveTrayLine
				this._update_gnomeParts();
			}));
		
		settings.connect("favorites-as-buttons", Lang.bind(this, function() {
				this._update_extras();
				
				if(this._CONF_smallFavs) {
					if(!this._ID_favUpdate)
						this._ID_favUpdate = AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._update_extras));
				}
				else if(this._ID_favUpdate) {
					AppFavorites.getAppFavorites().disconnect(this._ID_favUpdate);
					
					if(this._CONF_windowFavs)
						this._ID_favUpdate = AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._reload));
					else
						this._ID_favUpdate = false;
				}
			}));
		settings.connect("favorites-as-windows", Lang.bind(this, this._reload));
		
		settings.connect("fix-docklet-position-at", Lang.bind(this, function(k, v) {
				this._CONF_fixDockPositionAt = v;
				
				this.actorBox.setDockWidth(this._dockRealWidth);
				this._update_gnomeParts();
			}));
		settings.connect("expand-box", Lang.bind(this, function(k, v) {
				this._update_icons();
				if(!v)
					this.actorBox.setDockWidth(this._dockRealWidth);
			}));
		settings.connect("dock-width-percent", Lang.bind(this, function() {
				this._update_icons();
				if(!this._CONF_expandBox)
					this.actorBox.setDockWidth(this._dockRealWidth);
				
				this._update_gnomeParts();
			}));
		settings.connect("max-width-percent", Lang.bind(this, function() {
				this._update_icons();
				if(!this._CONF_expandBox)
					this.actorBox.setDockWidth(this._dockRealWidth);
				
				this._update_gnomeParts();
			}));
		settings.connect("dock-x-percent", Lang.bind(this, function(k,v) {
				this._CONF_dockX_percent = v;
				let Monitor = this._getMonitor(),
					monitorX = this._CONF_rotated ? Monitor.y : Monitor.x,
					monitorWidth = this._CONF_rotated ? Monitor.height : Monitor.width;
				this._DATA_real_x = monitorX + Math.round(monitorWidth * this._CONF_dockX_percent);
				
				this.actorBox.setDockWidth(this._dockRealWidth);
				this._update_gnomeParts();
			}));
		settings.connect("dock-y", Lang.bind(this, this._reload)); // left-right needs reload
		
		settings.connect("hover-window-list", Lang.bind(this, this._reload));//because of icon-enter-listener
		settings.connect("hover-timeout", Lang.bind(this, this._loadConfigs));//because of icon-enter-listener
		settings.connect("zoom-effect", Lang.bind(this, function(k, v) {
				if((this._CONF_zoomEffect = v)) {
					if(!this._ID_zoom_enterEvent) {
						this._ID_zoom_enterEvent = this.actor.connect("enter-event", Lang.bind(this, this.startZooming));
						this._ID_zoom_leaveEvent = this.actor.connect("leave-event", Lang.bind(this, this._check_stopZooming));
					}
					this._DATA_iconTextureSize = this._CONF_iconSize*2 - ICON_PADDING_SUM;
				}
				else {
					if(this._ID_zoom_enterEvent) {
						this.actor.disconnect(this._ID_zoom_enterEvent);
						this.actor.disconnect(this._ID_zoom_leaveEvent);
						this._ID_zoom_enterEvent = false;
					}
					this._DATA_iconTextureSize = this._CONF_iconSize - ICON_PADDING_SUM;
				}
				this._update_iconImages();
			}));
		settings.connect("only-screen-windows", Lang.bind(this, this._reload));
		settings.connect("only-one-icon", Lang.bind(this, this._reload));
		settings.connect("order-icons", Lang.bind(this, this._loadConfigs));
		settings.connect("list-all-workspaces", Lang.bind(this, function(k, v) {
				let actorBox = this.actorBox;
				if((this._CONF_showAllWS = v)) {
					actorBox._wsbg = new St.Bin({style_class: "wsListBack", x:this._group_space_left, width:this._DATA_inner_width});
					if(!this._CONF_autohide)
						actorBox.listWS();
				}
				else {
					if(!this._CONF_autohide) {
						actorBox.unlistWS();
						
						if(this._CONF_cutStruts) {
							let y = this._getStrutVars();
							
							this._strut_y(y[0]);
							this._strut_height(y[1]);
						}
					}
					actorBox._wsbg.destroy();
					actorBox._wsbg = false;
				}
			}));
		settings.connect("show-window-title", Lang.bind(this, this._update_icons));
		settings.connect("show-window-number", Lang.bind(this, this._reload));//_calcNumber() for each icon cant be used, or no numbers would be created, when onlyOneIcon is enabled
		settings.connect("smart-window-number", Lang.bind(this, function(k, v) {
				this._CONF_smartWindowNumber = v;
				let wsA = this._box._workspaces,
					i = wsA.length,
					wins, j, win;
				
				while(i--) {
					wins = wsA[i]._windows;
					j=wins.length;
					while(j--) {
						win = wins[j];
						if(v) {//if in loop, but its just a settings-update
							if(win._numLabel && (win._numLabel.text == "0" || win._numLabel.text == "1")) {
								win._numLabel.destroy();
								win._numLabel = false;
							}
						}
						else if(!win._numLabel)
							win._calcNumber();
					}
				}
				if(!v && !this._CONF_onlyOneIcon)
					this._correct_windowNumbers();//same loop again, but I don't care
			}));
		settings.connect("basic-button-width", Lang.bind(this, this._update_icons));
		settings.connect("basic-icon-size", Lang.bind(this, function() {
				this._update_icons();
				if(this._cutStrut) {
					this._cutStrut.destroy();
					this._cutStrut = false;
					this._addStrut();
				}
			}));
		settings.connect("middle-click-action", Lang.bind(this, this._loadConfigs));
		
		settings.connect("hide-time", Lang.bind(this, this._loadConfigs));
		settings.connect("show-time", Lang.bind(this, this._loadConfigs));
		settings.connect("time-until-hide", Lang.bind(this, this._loadConfigs));
		settings.connect("time-until-show", Lang.bind(this, this._loadConfigs));
	},
	
	_loadConfigs: function(completeLoad) {
		let group_space_left, dockRealWidth, dockY, hideTo;
		
		this._CONF_strutSpace = this.settings.get_int("strut-space");
		
		this._CONF_showWindowList = this.settings.get_boolean("show-window-list");
		
		this._CONF_hoverIcons = this.settings.get_boolean("hover-window-list");
		
		this._CONF_windowNumber = this.settings.get_boolean("show-window-number");
		this._CONF_smartWindowNumber = this.settings.get_boolean("smart-window-number");
		
		this._CONF_windowTexture = this.settings.get_boolean("show-window-texture");
		this._CONF_windowFavs = this.settings.get_boolean("favorites-as-windows");
		this._CONF_smallFavs = this.settings.get_boolean("favorites-as-buttons");
		
		
		this._CONF_onlyScreenWindows = this.settings.get_boolean("only-screen-windows");
		this._CONF_onAllScreens = this.settings.get_boolean("on-all-screens");
		this._CONF_onlyOneIcon = this.settings.get_boolean("only-one-icon");
		
		this._CONF_autohide = this.settings.get_boolean("autohide");
		this._CONF_dontHideSize = this.settings.get_int("dont-hide-size");
		this._CONF_hideToOpacity = this.settings.get_int("hide-to-opacity");
		this._CONF_hideTime = this.settings.get_double("hide-time");
		this._CONF_showTime = this.settings.get_double("show-time");
		this._CONF_hideTimeout = this.settings.get_int("time-until-hide");
		this._CONF_showTimeout = this.settings.get_int("time-until-show");
		this._CONF_hoverTimeout = this.settings.get_int("hover-timeout");
		
		this._CONF_orderIcons = this.settings.get_boolean("order-icons");
		this._CONF_zoomEffect = this.settings.get_boolean("zoom-effect");
		this._CONF_cutStruts = this.settings.get_boolean("cut-view");
		this._CONF_dockY_type = this.settings.get_enum("dock-y");
		if(this._CONF_dockY_type > ROTATION_MARK) {
			this._CONF_dockY_type -= ROTATION_MARK;
			this._CONF_rotated = true;
		}
		else
			this._CONF_rotated = false;
		this._CONF_middleClick = this.settings.get_enum("middle-click-action");
		this._CONF_showWindowTitle = this.settings.get_boolean("show-window-title");
		this._CONF_showAllWS = this.settings.get_boolean("list-all-workspaces");
		this._CONF_showWSline = this.settings.get_boolean("show-workspace-number");
		this._CONF_showWSNavigator = this.settings.get_boolean("show-workspace-navigator");
		this._CONF_wsNavigator_num = this.settings.get_int("workspace-navigators-num");
		this._CONF_showDesktopButton = this.settings.get_boolean("show-desktop-button");
		this._CONF_trayButton = this.settings.get_enum("create-tray-button");
		this._CONF_expandBox = this.settings.get_boolean("expand-box");
		this._CONF_fixDockPositionAt = this.settings.get_enum("fix-docklet-position-at");
		
		this._CONF_iconSize = Math.min(Math.max(this.settings.get_int("basic-icon-size"), 10), 100);
		
			
		this._CONF_buttonMaxWidth = this.settings.get_int("basic-button-width");
		if(this._CONF_buttonMaxWidth < 10)
			this._CONF_buttonMaxWidth = 10;
		else if(this._CONF_buttonMaxWidth > this._DATA_inner_width)
			this._CONF_buttonMaxWidth = this._DATA_inner_width;
		
		this._CONF_dockX_percent = this.settings.get_double("dock-x-percent");
		this._CONF_dockWidth_percent = this.settings.get_double("dock-width-percent");
		this._CONF_maxWidth_percent = this.settings.get_boolean("max-width-percent");
		
		this._CONF_moveTrayLine = (this._CONF_dockY_type==BOTTOM && !this._CONF_rotated && this._CONF_trayButton != NEVER);
		
		//----------DATA---------->
		
		
		if(this._CONF_windowFavs || this._CONF_smallFavs)
			this._cacheFavs();
		
		this._DATA_opacTo = this._CONF_autohide ? this._CONF_hideToOpacity : 255;
		
		let monitor = this._getMonitor(), //keep properties up to date
			monitorX, monitorY; //needed to calc screen
			
		if(this._CONF_rotated) {
			monitorX = monitor.y;
			monitorY = monitor.x;
			this._DATA_monitorWidth = monitor.height;
		}
		else {
			monitorX = monitor.x;
			monitorY = monitor.y;
			this._DATA_monitorWidth = monitor.width;
		}
		
		this._DATA_extraButtons_width = this._CONF_iconSize;
		
		let usualExtrasWidth = (this._CONF_showWSline ? WS_LABEL_WIDTH : 0)
				+ (this._CONF_showWSNavigator ? WS_NAVIGATOR_PADDING_LEFT + (this._DATA_extraButtons_width+WS_NAVIGATOR_SPACE) * this._CONF_wsNavigator_num : 0)
				+ (this._CONF_showDesktopButton ? this._DATA_extraButtons_width : 0);
			
		if(this._CONF_smallFavs) {
			this._DATA_favsX_begin = usualExtrasWidth;
			group_space_left = this._DATA_favsX_begin + this._favCache.length*this._CONF_iconSize + GROUP_PADDING_LEFT;
		}
		else {
			group_space_left = usualExtrasWidth + GROUP_PADDING_LEFT;
		}
		
		this._DATA_group_space_right = GROUP_PADDING_RIGHT;
		
		
		this._DATA_padding_x_sum = group_space_left + this._DATA_group_space_right;
		this._DATA_wsList_space = Math.round(this._CONF_iconSize/2);
		this._DATA_real_x = monitorX + Math.round(this._DATA_monitorWidth * this._CONF_dockX_percent);
		
		this._dockInnerHeight = this._CONF_iconSize;
		dockRealWidth = Math.round(this._DATA_monitorWidth * this._CONF_dockWidth_percent);
		
		if(this._CONF_expandBox) {
			this._DATA_inner_width = this._DATA_monitorWidth - this._DATA_padding_x_sum;
			this._DATA_inner_width = this._DATA_monitorWidth*this._CONF_maxWidth_percent - this._DATA_padding_x_sum;
			
			this._DATA_min_width = dockRealWidth;
		}
		else
			this._DATA_inner_width = dockRealWidth - this._DATA_padding_x_sum;
		
		
		if(this._CONF_dockY_type == BELOW_PANEL) {
			this._DATA_icons_ListedTo_default = 0;
			this._DATA_iconSpacingTop = 0;
			
			let h = Main.panel.actor.height;
			dockY = monitorY + h;
			hideTo = monitorY + h + this._CONF_dontHideSize - this._CONF_iconSize;
		}
		else if(this._CONF_dockY_type == TOP) {
			this._DATA_icons_ListedTo_default = 0;
			this._DATA_iconSpacingTop = 0;
			
			dockY = monitorY;
			hideTo = monitorY + this._CONF_dontHideSize - this._CONF_iconSize;
		}
		else {
			this._DATA_icons_ListedTo_default = GROUP_PADDING_BOTTOM;
			
			this._DATA_monitorStart = (this._CONF_rotated ? monitor.width : monitor.height) + monitorY;
			this._DATA_iconSpacingTop = GROUP_PADDING_BOTTOM;
			dockY = this._DATA_monitorStart - this._dockInnerHeight - GROUP_PADDING_BOTTOM;
			hideTo = dockY + (this._dockInnerHeight - this._CONF_dontHideSize);
		}
		
		
		this._DATA_max_icons = Math.floor(this._DATA_inner_width / this._CONF_iconSize);
		
		if(this._CONF_showWindowTitle)
			this._DATA_max_buttons = Math.floor(this._DATA_inner_width / this._CONF_buttonMaxWidth);
		else
			this._DATA_max_buttons = this._DATA_max_icons;
		
		this._DATA_iconTextureSize = (this._CONF_zoomEffect ? this._CONF_iconSize*1.5 : this._CONF_iconSize) - ICON_PADDING_SUM;
		
		let fontSize = Math.max(Math.round(this._CONF_iconSize/3), 10),
			icon_height = this._CONF_iconSize - ICON_PADDING_SUM,
			padding = icon_height - fontSize,
			label_padding_y = Math.round((icon_height - fontSize)/2);
		
		if(this._CONF_rotated)
			this._DATA_iconLabel_style = "font-size:"+fontSize+"px; padding:2px "+(label_padding_y+1)+"px 0 "+label_padding_y+"px";
		else
			this._DATA_iconLabel_style = "font-size:"+fontSize+"px; padding:"+label_padding_y+"px 2px 0 2px";
		
		this._DATA_iconLabel_minWidth = this._CONF_iconSize *2;
		
		this._DATA_wsLabel_style = "font-size:"+fontSize+"px; padding-top:"+((this._CONF_iconSize - fontSize)/2)+"px";
		this._DATA_wsNav_label = "font-size:"+fontSize+"px;";
		
		
		if(completeLoad == "all") {
			this._group_space_left = group_space_left;
			this._dockRealWidth = dockRealWidth;
			this._dockY = dockY;
			this._hideTo = hideTo;
		}
	},
	
	_x: function(obj) {
		return obj;
	},
	_y: function(obj) {
		let x = (obj.x != undefined),
			y = (obj.y != undefined),
			width = (obj.width != undefined),
			height = (obj.height != undefined),
			t;
		
		if(x || y) {
			t = obj.y;
			if(x)
				obj.y = obj.x;
			else
				delete obj.y;
			
			if(y)
				obj.x = t;
			else
				delete obj.x;
		}
		if(width || height) {
			t = obj.height;
			if(width)
				obj.height = obj.width;
			else
				delete obj.height;
			
			if(height)
				obj.width = t;
			else
				delete obj.width;
		}
		return obj;
	},
	_cacheFavs: function() {
		let launchers = global.settings.get_strv(AppFavorites.getAppFavorites().FAVORITE_APPS_KEY),
			i = launchers.length,
			app;
		this._favCache = [];
		while(i--) {
			app = Shell.AppSystem.get_default().lookup_app(launchers[i]);

			if(!app)
				continue;
			this._favCache.push(app);
		}
	},
	
	is_on_my_monitor: function(monitorI) {
		return (!this._CONF_onlyScreenWindows || this._realMonitorId == monitorI);
	},
	_getMonitor: function() {
		let i = this._realMonitorId;
		return LayoutManager.monitors[this._realMonitorId];
	},
	
	
	_getStrutVars: function() {
		let height = (this._CONF_autohide ?
					this._CONF_dontHideSize:
					(this.actorBox._WSareListed ?
						this.actorBox._calcListedHeight(this.actorBox._calcNeededWSlen(), this._CONF_iconSize+WS_LINES_SPACE_BETWEEN) :
						this._dockInnerHeight
					)
				) + GROUP_PADDING_BOTTOM,
			y;
		
		switch(this._CONF_dockY_type) {
			case BOTTOM:
				y = (this._CONF_autohide ? this._hideTo : (this._CONF_rotated ? this._getMonitor().width : this._getMonitor().height) - height) - this._CONF_strutSpace;
				height += this._CONF_strutSpace;
			break;
			case BELOW_PANEL:
				height += Main.panel.actor.height;
			default:
				height += this._CONF_strutSpace;
				y = 0;
		}
		return [y, height];
	},
	_addStrut: function() {
		let y = this._getStrutVars();
		
		//FIXME: there must be a better way... Lets look up the needed commands in the documentation. It was here somewhere, I know it...
		this._cutStrut = new St.Bin(this.xy({
				x: (this._CONF_rotated ? this._getMonitor().y : this._getMonitor().x),
				y: y[0],
				width: this._DATA_monitorWidth,
				height: y[1],
				style: "background-color:red"
			}));
		
		LayoutManager.addChrome(this._cutStrut, { affectsStruts: true });
		this._cutStrut.hide();
	},
	//FIXME: replace function for needed parts instead of only checking for rotated
	_strut_height: function(height) {
		if(this._CONF_rotated)
			this._cutStrut.set_width(height);
		else
			this._cutStrut.set_height(height);
	},
	_strut_y: function(y) {
		if(this._CONF_rotated)
			this._cutStrut.set_y(y);
		else
			this._cutStrut.set_x(y);
	},
	_addTrayButton: function() {
		let monitor = this._getMonitor();
		this._trayButton = new St.Button({style_class: "panelDocklet_trayButton",
				x: monitor.width - TRAY_BUTTON_SIZE,
				y: monitor.height - TRAY_BUTTON_SIZE
			});
		
		this._trayButton.connect("button-release-event", Lang.bind(this, function(actor, event) {
				let tray = Main.messageTray;
				//tray.toggle();
				
				if(tray._summaryState) {//enum: State -> 0 == hidden
					tray._pointerInTray = false;
					tray._pointerInSummary = false;
					tray.hide();}
				else {
					tray._pointerInSummary = true;
					tray._updateState();
				}
			}));
		LayoutManager.addChrome(this._trayButton);
		
		//little hack: why overwriting a function, or removing a listener (which I cant), when I can just remove the ability to answer events?
		//Main.messageTray._summary.reactive = false;
		
		this._trayBox_oldY = LayoutManager.trayBox.get_y();
		
		//because mouse-over isnt needed anymore, I can remove the "blind pixel" at the bottom
		if(this._CONF_moveTrayLine)
			LayoutManager.trayBox.set_y((this._CONF_autohide ? this._hideTo : this._dockY) + 1);
		else
			LayoutManager.trayBox.set_y(this._trayBox_oldY + 1);
	},
	_removeTrayButton: function() {
		this._trayButton.destroy();
		Main.messageTray._summary.reactive = true;
		LayoutManager.trayBox.set_y(this._trayBox_oldY);
		this._trayButton = false;
	},
	
	_is_trayButton_needed: function() {
		return (this._monitorId=="primary"
				&& (this._CONF_trayButton == ALWAYS
					|| (this._CONF_trayButton == AUTO 
						&& this._CONF_dockY_type == BOTTOM
						&& (this.actorBox._calcDockX(this._dockRealWidth) + this._dockRealWidth > this._DATA_monitorWidth - MESSAGE_TRAY_DEAD_ZONE
							|| (this._CONF_expandBox
								&& this._CONF_fixDockPositionAt == FIXED_RIGHT)))));
	},
	
	_onWindowDemandsAttention : function(display, window) {
		//look into windowAttentionHandler.js:29 in gnome-shell - source

		if (!window || !window[this._WIN_VAR_KEY_icon] || window.has_focus() || window.is_skip_taskbar())
			return;
		
		window[this._WIN_VAR_KEY_icon].showAttention(global.screen.get_active_workspace_index());
	},
	
	_check_hideWindowList: function() {
		let position = global.get_pointer(),
			actor = this._windowList.actor,
			obj = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, position[0], position[1]);
		
		if(obj != actor && !actor.contains(obj))
			this.hideWindowList();
	},
	hideWindowList: function() {
		if(this._windowList_current) {
			this._windowList_current = false;
			this._windowList.actor.hide();
		}
		if(this._windowList_timeout) {
			Mainloop.source_remove(this._windowList_timeout);
			this._windowList_timeout = false;
		}
	},
	
	startZooming: function() {
		if(this._isZooming || this._menu)
			return;
		
		this._ID_mouseTracking = Mainloop.timeout_add(MOUSE_POLL_FREQUENCY, Lang.bind(this, this.setZooming));
		this.setZooming();//we dont want to wait for first zoom
		this._isZooming = true;
	},
	setZooming: function() {
		if(this._CONF_autohide && this.actorBox._isHidden)
			return true;
		let pointer = this.actorBox.get_boxMouse(),
			wsI = this._box.getWSunderMousePos(pointer.y);
		
		if(this._lastZoomWS != wsI) {
			if(this._lastZoomWS != null)
				this._box._workspaces[this._lastZoomWS].undoIconsZoom();
			this._lastZoomWS = wsI;
			/*only needed, if icons get bigger, than one row - buggy: pointer will get in the back!
			
			let wins = this._box._workspaces[this._lastZoomWS = wsI]._windows, //Variable is changed here!
				i = wins.length;
			while(i--)
				//wins[i].actor.lower(this._windowList.actor); //window-list should allways be on top, but below drag-pointer
				wins[i].actor.raise_top(); //window-list should allways be on top, but below drag-pointer*/
		}
		
		this._box._workspaces[wsI].zoomIcons(pointer.x);
		return true;//do it again
	},
	_check_stopZooming: function(actor, event) {
		if(!this._menu && this.actorBox._dock_lost_hover(this.actor)) {
			this.stopZooming();
			this.removeZoom();
		}
	},
	stopZooming: function() {
		if(this._isZooming) {
			
			this._isZooming = false;
			Mainloop.source_remove(this._ID_mouseTracking);
			this._ID_mouseTracking = false;
		}
	},
	removeZoom: function() {
		if(this._lastZoomWS != null) {
			this._box._workspaces[this._lastZoomWS].undoIconsZoom();
			this._lastZoomWS = null;
		}
	},
	
	_update_gnomeParts: function() {
		if(this._monitorId != "primary")//Asuming: no hot corners on secundary screens
			return;
		if(this._CONF_rotated)
			this.actor.set_x(this.actorBox._isHidden ? this._hideTo : this._dockY);
		else
			this.actor.set_y(this.actorBox._isHidden ? this._hideTo : this._dockY);
		
		
		//can be set to ALWAYS:
		let trayIsNeeded = this._is_trayButton_needed();
		
		if(this._trayButton)//so tray-position is set when created new
			this._removeTrayButton();
			
		if(trayIsNeeded)
			this._addTrayButton();
		
		
		if(this._CONF_cutStruts) {
			this._cutStrut.destroy();
			this._addStrut();
		}
		if(this._CONF_dockY_type == BELOW_PANEL) {
			if(!this._ID_panelEnterEvent) {
				this.actor.lower(LayoutManager.panelBox);//to correct raise()
				
				if(this._CONF_autohide)
					this.actorBox._addPanelEvents();
			}
		}
		else if(this._CONF_dockY_type == BOTTOM)
			this.actorBox.lowerActor(true);
		else {
			this.actor.raise(LayoutManager.panelBox);//to correct lower()
			this.actorBox._removePanelEvents();
		}
		
		
	},
	_update_iconImages: function() {
		let wsAll = this._box._workspaces,
			i = wsAll.length,
			iconSize,
			wins, j, win, icon;
		
		while(i--) {
			iconSize = wsAll[i]._iconSize - ICON_PADDING_SUM;
			wins = wsAll[i]._windows;
			j = wins.length;
			while(j--) {
				win = wins[j];
				icon = win._icon;
					
				icon.destroy();
				icon = win._icon = win._myApp.create_icon_texture(this._DATA_iconTextureSize);
				win._group.add(icon);
				icon.set_size(iconSize, iconSize);
				
				if(win._numLabel)
					win._numLabel.raise(icon);
			}
			wsAll[i].reloadAllLabels(this._CONF_showWindowTitle); //to make sure, label is displayed after icon
		}
	},
	_update_extras: function() {
		let actorBox = this.actorBox;
		actorBox.removeExtras();
		this._loadConfigs("all");//will be done again in _update_icons. But its only a settings-update...
		
		if(actorBox._wsbg) {
			if(this._CONF_rotated)
				actorBox._wsbg.set_y(this._group_space_left);
			else
				actorBox._wsbg.set_x(this._group_space_left);
			
		}
		actorBox._createExtras();
		
		this._update_icons();
		
		if(actorBox._WSareListed) {
			actorBox.unlistWS();
			actorBox.listWS();
		}
	},
	_update_icons: function() {
		this._loadConfigs("all");
		
		let box = this._box,
			actorBox = this.actorBox,
			cws = box._currentWS,
			wsAll = box._workspaces,
			i = wsAll.length,
			lineY, lineHeight, ws, l, y;
		
		if(this._CONF_dockY_type == BOTTOM)
			y = GROUP_PADDING_BOTTOM;
		else
			y = 0;
		
		
		if(this._CONF_showWSNavigator || this._CONF_smallFavs) {
			actorBox.removeExtras();
			actorBox._createExtras();
		}
		else
			this.actorBox.adjustButtons(this._dockInnerHeight);//setDockHeight: only if(s<=this._CONF_iconSize)
		
		
		this._update_iconImages();//has to be before reloadAllLabels(), or labels will be displayed before icons
		while(i--) {
			ws = wsAll[i];
			l = ws._windows.length;
			
			if(this._CONF_showWindowTitle && l < this._DATA_max_icons) {
				ws._iconSize = this._CONF_iconSize;
				ws._setButtonSize(l);
				if(cws == ws._myWorkspace.index())
					ws._updateHeight(this._CONF_iconSize); //wont be done in _setButtonSize
			}
			else
				ws._setIconSize(l);
			
			ws.reloadAllLabels(this._CONF_showWindowTitle);
			ws.moveIcons(y);
		}
		
		if(actorBox._WSareListed) {
			actorBox.unlistWS();
			actorBox.listWS();
		}
		
		
		if(this._CONF_expandBox)
			this.actorBox.setExpandedDockWidth(wsAll[cws]._windows.length, wsAll[cws]);
	},
	_correct_windowNumbers: function() {
		let confSmart = this._CONF_smartWindowNumber,
			counter = {},
			wsA = this._box._workspaces,
			maxI = wsA.length,
			i=0,
			id, t, wins, maxJ, j, win;
		
		for(; i<maxI; ++i) {
			for(wins=wsA[i]._windows, maxJ=wins.length, j=0; j<maxJ; ++j) {
				win = wins[j];
				if(!win._numLabel)
					continue;
				id = win._myApp.get_id();
				t = (!counter[id]) ? (counter[id] = 1) : ++counter[id];
				if(confSmart && t <= 1) {
					win._numLabel.destroy();
					win._numLabel = false;
				}
				else
					win._numLabel.text = t.toString();
			}
		}
	},
	
	_reload: function() {
		this._destroy(true);
		this._init(this._monitorId, this._secondaryPanelDocklets);
		
		if(this._CONF_windowNumber && !this._CONF_onlyOneIcon)
			this._correct_windowNumbers();
		if(this._monitorId == "primary")
			this.settings.connect("on-all-screens", reloadAllDocklets); //this is not a real connect!
	},
	_destroy: function(justReload) {
		if(this._ID_favUpdate) {
			AppFavorites.getAppFavorites().disconnect(this._ID_favUpdate);
			this._ID_favUpdate = false;
		}
		
		if(this._ID_xdnd_dragEnd_list) {
			Main.xdndHandler.disconnect(this._ID_xdnd_dragEnd_list);
			this._ID_xdnd_dragEnd_list = false;
		}
		
		if(this._ID_list_leaveEvent) {
			this._windowList.actor.disconnect(this._ID_list_leaveEvent);
			this.actor.disconnect(this._ID_list_icon_leaveEvent);
			this._ID_list_leaveEvent = false;
			if(this._ID_list_hide_leaveEvent) {
				this._windowList.actor.disconnect(this._ID_list_hide_leaveEvent);
				this._ID_list_hide_leaveEvent = false;
			}
		}
		
		global.display.disconnect(this._ID_attention);

		if(this._trayButton)
			this._removeTrayButton();
		
		if(this._ID_mouseTracking) {
			Mainloop.source_remove(this._ID_mouseTracking);
			this._ID_mouseTracking = false;
		}
		
		this._box._destroy();
		this.actorBox._destroy();
		
		if(this._menu) {
			this._menu._destroy();
			this._menu = false;
		}
		
		if(this._cutStrut) {
			this._cutStrut.destroy();
			this._cutStrut = false;
		}
		if(this._settingsMenu && !justReload) {
			this._settingsMenu.close();
			this._settingsMenu = false;
		}
	}
}


function ActorBox(dock) {
	this._init(dock);
}
ActorBox.prototype = {
	_init: function(dock) {
		this._dock = dock;
		this._isHidden = false;
		this._hide_Timeout = false;
		this._show_Timeout = false;
		this._WSareListed = false;
		
		
		let panelColor = Main.panel.actor.get_theme_node().get_color("background-color");
		this.actor = new St.BoxLayout(dock.xy({ name: "panelDocklet",
				reactive: true,
				can_focus: true,
				x: this._calcDockX(dock._dockRealWidth),
				y: dock._dockY,
				width: dock._dockRealWidth,
				height: dock._dockInnerHeight + GROUP_PADDING_BOTTOM,
				style_class: "panelDocklet " + this.get_positionStyle(),
				style: "background-color:rgba("+panelColor.red+","+panelColor.blue+","+panelColor.blue+","+panelColor.alpha+")"
			}));
		
		
		this.actor._delegate = dock;
		LayoutManager.addChrome(this.actor);
		this._ID_clickEvent = this.actor.connect("button-release-event", Lang.bind(this, this._onMouseClick));
		
		
		//if(!dock._CONF_moveTrayLine) {
			this._ID_overviewShowing = Main.overview.connect('shown', Lang.bind(this, Lang.bind(this, function() {if(!this._dock._CONF_moveTrayLine) this.actor.hide();})));
			this._ID_overviewHiding = Main.overview.connect('hidden', Lang.bind(this, Lang.bind(this, function() {this.actor.show();})));
		//}
		if(dock._CONF_autohide) {
			this._ID_xdnd_dragBegin = Main.xdndHandler.connect('drag-begin', Lang.bind(this, this._showDock));
			this._ID_xdnd_dragEnd_hide = Main.xdndHandler.connect('drag-end', Lang.bind(this, this._hideDock));
			
			if(dock._CONF_dockY_type == BELOW_PANEL) {
				this.actor.lower(LayoutManager.panelBox); //this code twice, saves an executed if
				this._addPanelEvents();
			}
			else if(dock._CONF_dockY_type == BOTTOM)
				this.lowerActor();
			
			this._ID_enterEvent = this.actor.connect("enter-event", Lang.bind(this, this._check_showDock));
			this._ID_leaveEvent = this.actor.connect("leave-event", Lang.bind(this, this._check_hideDock));
		}
		else {
			if(dock._CONF_dockY_type == BELOW_PANEL)
				this.actor.lower(LayoutManager.panelBox);
			else if(dock._CONF_dockY_type == BOTTOM)
				this.lowerActor();
		}
		
		if(dock._CONF_zoomEffect) {
			this._ID_zoom_enterEvent = this.actor.connect("enter-event", Lang.bind(dock, dock.startZooming));
			this._ID_zoom_leaveEvent = this.actor.connect("leave-event", Lang.bind(dock, dock._check_stopZooming));
		}
		
		if(dock._CONF_showAllWS)
			this._wsbg = new St.Bin(dock._CONF_rotated ?
				{style_class: "wsListBack", y:dock._group_space_left, height:dock._DATA_inner_width} :
				{style_class: "wsListBack", x:dock._group_space_left, width:dock._DATA_inner_width});
	},
	
	get_positionStyle: function() {
		return (this._dock._CONF_rotated ? 
				((this._dock._CONF_dockY_type == BOTTOM) ? "right" : "left") :
				((this._dock._CONF_dockY_type == BOTTOM) ? "bottom" : "top")
			);
	},
	
	/*_dock_lost_hover: function(actor) {
		//let position = event.get_coords(),
		let position = global.get_pointer(),
			obj = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, position[0], position[1]);
		
		if(obj == actor || actor.contains(obj))
			return false;
		else
			return true;
	},*/
	lowerActor: function(raise) {
		let dock = this._dock;
		if(dock._monitorId=="primary" && !dock._CONF_moveTrayLine && (dock._CONF_dontHideSize > 5 || !dock._CONF_autohide)
				&& (this._calcDockX(dock._dockRealWidth) + dock._dockRealWidth > dock._DATA_monitorWidth - MESSAGE_TRAY_NEEDED_ZONE
					|| (dock._CONF_expandBox && dock._CONF_fixDockPositionAt == FIXED_RIGHT)))
			this.actor.lower(LayoutManager.trayBox);
		
		else if(raise)
			this.actor.raise(LayoutManager.trayBox);
	},
	
	_addPanelEvents: function() {
		let panel = Main.panel.actor;
		
		this._ID_panelEnterEvent = panel.connect("enter-event", Lang.bind(this, this._check_showDock));
		this._ID_panelLeaveEvent = panel.connect("leave-event", Lang.bind(this, function() {
			if(!this._dock._menu) {
				if(this._show_Timeout)
					Mainloop.source_remove(this._show_Timeout);
				
				this._hide_Timeout = Mainloop.timeout_add(this._dock._CONF_hideTimeout, Lang.bind(this, this._hideDock));
			}
			}));
		//this._ID_overviewShowing = Main.overview.connect('shown', Lang.bind(this, this._hideDock));
	},
	_removePanelEvents: function() {
		if(!this._ID_panelEnterEvent)
			return;
		let panel = Main.panel.actor;
		
		panel.disconnect(this._ID_panelEnterEvent);
		panel.disconnect(this._ID_panelLeaveEvent);
		this._ID_panelEnterEvent = false;
	},
	
	_check_showDock: function(actor, event) {
		if(this._dock_lost_hover(this.actor))
			return;
		if(this._hide_Timeout) {
			Mainloop.source_remove(this._hide_Timeout);
			this._hide_Timeout = false;
		}
		this._show_Timeout = Mainloop.timeout_add(this._dock._CONF_showTimeout, Lang.bind(this, this._showDock));
	},
	_check_hideDock: function(actor, event) {
		if(this._show_Timeout) {
			Mainloop.source_remove(this._show_Timeout);
			this._show_Timeout = false;
		}
		
		if(!this._dock._menu && !this._dock._windowList_current && this._dock_lost_hover(this.actor) && !this._dock._box.noWindows_shown())
			this._hide_Timeout = Mainloop.timeout_add(this._dock._CONF_hideTimeout, Lang.bind(this, this._hideDock));
	},
	
	setExpandedDockWidth: function(l, winBox) {
		let dock = this._dock;
		
		if(this._WSareListed) {
			if(l < dock._winLenRecord) {
				l = dock._winLenRecord;
				winBox = dock._winLenRecordClass;
			}
			this._wsbg.set_width(dock._dockRealWidth - dock._DATA_padding_x_sum);
		}
		
		if(l < dock._DATA_max_icons && (!dock._CONF_showWindowTitle || l < dock._DATA_max_buttons)) {
			let w = l * (dock._CONF_showWindowTitle ? dock._CONF_buttonMaxWidth : dock._CONF_iconSize) + dock._DATA_padding_x_sum;
			if(w < dock._DATA_min_width)
				w = dock._DATA_min_width;
			this.setDockWidth(w);
		}
		else {
			this.setDockWidth(dock._DATA_monitorWidth*dock._CONF_maxWidth_percent);
			if(l >= dock._DATA_max_icons)
				winBox._setIconSize(l);
			else
				winBox._setButtonSize(l);
		}
	},
	_calcDockX: function(w) {
		switch(this._dock._CONF_fixDockPositionAt) {
			case FIXED_RIGHT:
				return this._dock._DATA_real_x - w;
			case FIXED_MIDDLE:
				return this._dock._DATA_real_x - Math.ceil(w/2);
			default:
				return this._dock._DATA_real_x;
		}
	},
	
	removeExtras: function() {//for conf-update
		if(this._ID_stateChanged) {
			let favs = this._dock._favCache,
				i = favs.length;
			
			while(i--) {
				favs[i].disconnect(this._ID_stateChanged[i]);
			}
			this._ID_stateChanged = false;
		}
		if(this._extraContainer)
			this._extraContainer.destroy();
	},
	_createExtras: function() {
		let dock = this._dock,
			xy = dock.xy,
			extraX = 0,
			extraH = dock._dockInnerHeight,
			extraContainer;
		
		if(dock._CONF_showDesktopButton || dock._CONF_showWSNavigator || dock._CONF_showWSline || dock._CONF_smallFavs) {
			extraContainer = this._extraContainer = new St.BoxLayout(xy({style_class:"extraContainer",
					width: dock._group_space_left - GROUP_PADDING_LEFT,
					x: 1,
					y: 1
				}));
			this._setExtraBackHeight(extraH);
			this.actor.add(extraContainer);
		}
		else
			return;
		
		
		if(dock._CONF_showDesktopButton) {
			this._minimizedWinsFromButton = [];
			
			this._desktopButton = new St.Button(xy({style_class:"toDesktop",
					y: 1,
					x: extraX,
					width: dock._DATA_extraButtons_width
				}));
			this._desktopButton.connect("button-press-event",  Lang.bind(this, this._showDesktop));
			
			extraContainer.add(this._desktopButton);
			this._setDesktopButtonHeight(extraH);
			
			extraX += dock._DATA_extraButtons_width;
		}
		
		
		if(dock._CONF_showWSline) {
			this._wsLabels = [];
			
			this._currentWSlabel = new St.Label(xy({style_class:"wsLabelMain",
					text: "1",
					width: WS_LABEL_WIDTH,
					x: extraX,
					y: 0
				}));
			extraContainer.add(this._currentWSlabel);
			this._setWSlabelPadding(dock._CONF_iconSize);
			extraX += WS_LABEL_WIDTH;
		}
		
		if(dock._CONF_showWSNavigator) {
			this._wsNavigator = [];
			
			let w = dock._DATA_extraButtons_width,
				x = w+WS_NAVIGATOR_SPACE;
			extraX += WS_NAVIGATOR_PADDING_LEFT;
			
			for(let i=0, max = dock._CONF_wsNavigator_num, item; i<max; ++i) {
				item = new St.Button(xy({style:dock._DATA_wsNav_label, style_class:"wsNavigator", y: WS_NAVIGATOR_PADDING_Y, x: extraX, width:w}));
				item.set_child(new St.Label({text: (i+1).toString()}));
				item.i = i;
				item.connect("button-press-event",  Lang.bind(item, function() {
					let ws;
					if(this.i >= global.screen.n_workspaces)
						ws = global.screen.get_workspace_by_index(global.screen.n_workspaces-1);
					else
						ws = global.screen.get_workspace_by_index(this.i);
					
					// Funny idea. But not possible, since the workspace will be removed again instantly...
					/*let ws = global.screen.get_workspace_by_index(this.i);
					while(!ws) {
						ws = global.screen.append_new_workspace(false, global.get_current_time());
					}*/
					ws.activate(global.get_current_time());
				}));
				extraContainer.add(item);
				this._wsNavigator.push(item);
				
				extraX +=x;
			}
			if(dock._box._currentWS <= dock._CONF_wsNavigator_num)
				this._wsNavigator[dock._box._currentWS].add_style_pseudo_class("focused");
			this._setWSnavigatorHeight(extraH);
			
		}
		
		
		if(dock._CONF_smallFavs) {
			this._smallFavs = [];
			this._ID_stateChanged = [];
			let confIconSize = dock._CONF_iconSize,
				favs = dock._favCache,
				i = favs.length,
				item, icon, app;
			
			while(i--) {
				app = favs[i];
				item = new St.Button(xy({ style_class: "favIcon windowIconButton",
					reactive: true,
					can_focus: false,
					y: 0,
					opacity: (app.state != Shell.AppState.STOPPED) ? 255 : ICON_MINIMIZED_OPACITY,
					x_fill: true,
					y_fill: true
				}));
				item._myApp = app;
				icon = app.create_icon_texture(confIconSize);
				item.set_child(icon);
				item.connect("button-release-event", Lang.bind(item, function(actor, event) {
						let button = event.get_button();
						switch(button) {
							case 3:
							break;
							default:
							this._myApp.open_new_window(global.screen.get_active_workspace_index());
						}
					}));
				this._ID_stateChanged[i] = app.connect('notify::state', Lang.bind(item, function(){
						if(this._myApp.state != Shell.AppState.STOPPED)
							this.opacity = 255;
						else
							this.opacity = ICON_MINIMIZED_OPACITY;
					}));
						
				
				extraContainer.add(item);
				this._smallFavs.push(item);
				extraX += confIconSize;
			}
			this._setFavsSize(extraH);
		}
	},
	
	adjustButtons: function(dockH) {
		let dock = this._dock;
		
		if(dock._CONF_showWSline || dock._CONF_showWSNavigator || dock._CONF_showDesktopButton || dock._CONF_smallFavs) {
			this._setExtraBackHeight(dockH);
			
			if(dock._CONF_showWSline)
				this._setWSlabelPadding(dockH);
			if(dock._CONF_showWSNavigator)
				this._setWSnavigatorHeight(dockH);
			if(dock._CONF_showDesktopButton)
				this._setDesktopButtonHeight(dockH);
			if(dock._CONF_smallFavs)
				this._setFavsSize(dockH);
		}
	},
	
	listWS: function() {
		if(this._WSareListed)
			return;
		this._WSareListed = true;
		
		let dock = this._dock,
			ws = dock._box._workspaces,
			neededLen = this._calcNeededWSlen(),
			cI = dock._box._currentWS,
			
			confShowWSline = dock._CONF_showWSline,
			isBottom = (dock._CONF_dockY_type == BOTTOM),
		
			start_sum = (isBottom ? GROUP_PADDING_BOTTOM : dock._CONF_iconSize + dock._DATA_wsList_space),
			bg_height = 0,
			sum = start_sum,
			lineHeight = dock._CONF_iconSize + WS_LINES_SPACE_BETWEEN,
			dockHeight = this._calcListedHeight(neededLen, lineHeight);
		
		
		if(dock._CONF_expandBox)
			this.setExpandedDockWidth(0);
		this.setDockHeight(dockHeight, isBottom);
		
		
		for(let i=0, max = neededLen; i<max; ++i) {
			if(i==cI) {
				if(isBottom) {
					let pos = this._calcListedBottomPos(i, dockHeight);
					ws[i].moveIcons(pos);
					
					if(this._extraContainer)
						this.set_extraContainerY(pos);
				}
				
				bg_height = sum;
				continue;
			}
			ws[i].activateIcons(sum);
			
			if(confShowWSline)
				this.addWSlabel(i+1, sum);
			
			sum += lineHeight;
		}
		if(!dock._CONF_autohide && dock._CONF_cutStruts) {
			let y = dock._getStrutVars();
			
			dock._strut_y(y[0]);
			dock._strut_height(y[1]);
		}
		
		this.set_wsbg_widthY(dock._dockRealWidth - dock._DATA_padding_x_sum, start_sum);
		this.set_wsbg_height(bg_height - start_sum);
		
		this.actor.add(this._wsbg);
		this._wsbg.lower_bottom();
	},
	unlistWS: function(cI) {
		if(!this._WSareListed)
			return;
		
		this._WSareListed = false;
		
		cI = ((cI!=undefined) ? cI : this._dock._box._currentWS); //0==false
		let dock = this._dock,
			ws = dock._box._workspaces,
			wsI = ws.length;
		
		if(dock._CONF_showWSline) {
			let labels = this._wsLabels,
				laI = labels.length;
			
			while(laI--) {
				labels[laI].destroy();
			}
			this._wsLabels = [];
		}
		if(this._extraContainer)
			this._extraContainer.set_y(1);
		
		this.actor.remove_actor(this._wsbg);
		
		ws[cI]._updateHeight();
		if(dock._CONF_dockY_type == BOTTOM)
			ws[cI].moveIcons(dock._DATA_iconSpacingTop);
		
		while(wsI--) {
			if(wsI != cI)
				ws[wsI].removeAllIcons(true, true);
		}
		
		if(dock._CONF_expandBox)
			this.setExpandedDockWidth(ws[cI]._windows.length, ws[cI]);
	},
	addWSlabel: function(i, y) {
		let item = new St.Label({text:i+":", x:WS_LINES_SPACE_LEFT, y:y, style:this._dock._DATA_wsLabel_style});
		this.actor.add(item);
		this._wsLabels.push(item);
	},
	
	_calcListedHeight: function(neededLen, lineHeight) {
		return ((neededLen > 1) ? neededLen*lineHeight - WS_LINES_SPACE_BETWEEN + this._dock._DATA_wsList_space : this._dock._CONF_iconSize);
	},
	_calcNeededWSlen: function() {
		let box = this._dock._box,
			len = box._workspaces.length;
		return (box._currentWS != len-1 && !box._workspaces[len-1]._windows.length && !box._allWsWindows) ? len-1 : len;
	},
	_calcListY: function() {
		let confIconSize = this._dock._CONF_iconSize;
		return confIconSize + Math.round(confIconSize/3);
	},
	_calcListedBottomPos: function(i, h) {
		return h- this._dock._CONF_iconSize*2 + this._dock._box._workspaces[i]._iconSize + GROUP_PADDING_BOTTOM;
	},
	
	_showDesktop: function() {
		let minW = this._minimizedWinsFromButton,
			i = minW.length,
			currentWS = this._dock._box._currentWS,
			maxedSomething = false,
			ws, win;
		
		while(i--) {
			win = minW[i];
			ws = win.get_workspace();
			
			if(!ws || ws.index() != currentWS || !win.minimized)
				continue;
			
			win.unminimize();
			
			if(!maxedSomething)
				maxedSomething = true;
		}
		
		minW = this._minimizedWinsFromButton = [];
		
		if(!maxedSomething) {
			let tracker = Shell.WindowTracker.get_default(),
				thisMonitor = this._dock._realMonitorId,
				confScreens = this._dock._CONF_onlyScreenWindows,
				wins = this._dock._box._workspaces[currentWS]._myWorkspace.list_windows(),
				i = wins.length;
			
			while(i--) {
				win = wins[i];
				if(win.minimized || !tracker.is_window_interesting(win) || (win.get_monitor() != thisMonitor && confScreens))
					continue;
				
				minW.push(win);
				win.minimize();
			}
		}
	},
	
	_destroy: function() {
		Main.overview.disconnect(this._ID_overviewShowing);
		Main.overview.disconnect(this._ID_overviewHiding);
		if(this._ID_enterEvent) {
			this.actor.disconnect(this._ID_enterEvent);
			this.actor.disconnect(this._ID_leaveEvent);
			this._ID_enterEvent = false;
		}
		if(this._ID_zoom_enterEvent) {
			this.actor.disconnect(this._ID_zoom_enterEvent);
			this.actor.disconnect(this._ID_zoom_leaveEvent);
			this._ID_zoom_enterEvent = false;
		}
		
		if(this._ID_xdnd_dragBegin) {
			Main.xdndHandler.disconnect(this._ID_xdnd_dragBegin);
			this._ID_xdnd_dragBegin = false;
		}
		if(this._ID_xdnd_dragEnd_hide) {
			Main.xdndHandler.disconnect(this._ID_xdnd_dragEnd_hide);
			this._ID_xdnd_dragEnd_hide = false;
		}
		
		this.actor.disconnect(this._ID_clickEvent);
		this._removePanelEvents();
		
		this.actor.destroy();
	}
};

function X_ActorBox(dock) {
	ActorBox.prototype._init.call(this, dock);
}
X_ActorBox.prototype = {
    __proto__: ActorBox.prototype,
	
	_onMouseClick: function(actor, event) {
		let dock = this._dock;
		if(event.get_button()==1) {
			let wsI = dock._box.getWSunderMousePos(global.get_pointer()[1] - this.actor.y);
			if(wsI != dock._box._currentWS)
				global.screen.get_workspace_by_index(wsI).activate(global.get_current_time());
			
			return;
		}
		else if(dock._menu || this._isHidden || event.get_button() != 3)
			return;
		
		dock._menu = new DockletMenu(dock);
	},
	get_boxMouse: function() {
		let m = global.get_pointer();
		
		return {x: m[0] - this.actor.x, y: m[1] - this.actor.y};
		//return {x: m[0] - this._calcDockX(this._dock._dockRealWidth), y: m[1] - this.actor.y}; //same result - but one less actor-property read -> better?
	},
	
	_setWSlabelPadding: function(s) {
		this._currentWSlabel.set_y(Math.round((s - WS_LABEL_FONT_SIZE) / 2 - 2));
	},
	_setWSnavigatorHeight: function(dockH) {
		let i = this._dock._CONF_wsNavigator_num,
			obj = this._wsNavigator,
			h = dockH - WS_NAVIGATOR_PADDING_Y*2;
			
		while(i--) {
			obj[i].set_height(h);
		}
	},
	_setDesktopButtonHeight: function(dockH) {
		this._desktopButton.set_height(dockH-2);
	},
	_setFavsSize: function(dockH) {
		let dock = this._dock,
			favs = this._smallFavs,
			i = favs.length,
			diff = dock._DATA_smallFav_width - dockH,
			x = dock._DATA_favsX_begin;
			
		
		while(i--) {
			Tweener.addTween(favs[i], {
				x: x,
				width: dockH,
				height: dockH,
				time: 0.3,
				transition: "easeInOutCubic"
			});
			x += dockH;
		}
		dock._group_space_left = x + GROUP_PADDING_LEFT;
		if(this._wsbg)
			this._wsbg.set_x(dock._group_space_left);
		this._extraContainer.set_width(x);
	},
	_setExtraBackHeight: function(dockH) {
		this._extraContainer.set_height(dockH);
	},
	
	
	_dock_lost_hover: function(actor) {
		let position = global.get_pointer(),
			dock = this._dock,
			x = this._calcDockX(dock._dockRealWidth),
			y = this.actor.y;
		if(position[0] < x || position[0] >= x+dock._dockRealWidth || position[1] < y || position[1] >= y+this.actor.height)
			return true;
		else
			return false;
	},
	
	
	_showDock: function() {
		if(this._hide_Timeout)
			Mainloop.source_remove(this._hide_Timeout);
		
		if(!this._isHidden)
			return;
		this._isHidden=false;
		
		let dock = this._dock;
		
		if(dock._CONF_showAllWS)
			this.listWS();
		else 
			Tweener.addTween(this.actor, {
					y: dock._dockY,
					opacity: 255,
					time: dock._CONF_showTime,
					transition: "easeOutQuad"
				});
	},
	_hideDock: function() {
		if(this._isHidden)
			return;
		this._isHidden=true;
		
		let dock = this._dock;
		
		if(dock._CONF_autohide && this._WSareListed)
			this.unlistWS();
		else {
			Tweener.addTween(this.actor, {
					y: dock._hideTo,
					opacity: dock._DATA_opacTo,
					time: dock._CONF_hideTime,
					transition: "easeOutQuad"
				});
		}
	},
	
	setDockHeight: function(s, correctBottomHeight, hide) {//this can be used for temporarely height-changes
		let dock = this._dock,
			yPos;
		if(s && s != dock._dockInnerHeight) {
			dock._dockInnerHeight = s;
			
			if(s<=dock._CONF_iconSize) {
				this.adjustButtons(s);
			}
		}
		else
			s = dock._dockInnerHeight;
		
		if(correctBottomHeight)
			yPos = dock._DATA_monitorStart - s - GROUP_PADDING_BOTTOM;
		else if(hide)
			yPos = dock._hideTo;
		else
			yPos = dock._dockY;
		
		
		
		Tweener.addTween(this.actor, {
				height: GROUP_PADDING_BOTTOM + s,
				y: yPos,
				opacity: hide ? dock._DATA_opacTo : 255,
				time: (hide ? dock._CONF_hideTime : dock._CONF_showTime),
				transition: "easeOutQuad"
			});
		
	},
	setDockWidth: function(w) {
		this._dock._dockRealWidth = w;
		Tweener.addTween(this.actor, {
				x: this._calcDockX(w),
				width: w,
				time: 0.3,
				transition: "easeInOutCubic"
			});
	},
	
	set_extraContainerY: function(y) {
		this._extraContainer.set_y(y);
	},
	set_wsbg_height: function(h) {
		if(h) {
			this._wsbg.show();
			this._wsbg.set_height(h - WS_LINES_SPACE_BETWEEN);
		}
		else
			this._wsbg.hide();
	},
	set_wsbg_widthY: function(w, y) {
		this._wsbg.set_y(y);
		this._wsbg.set_width(w);
	}
}
function Y_ActorBox(dock) {
	ActorBox.prototype._init.call(this, dock);
}
Y_ActorBox.prototype = {
    __proto__: ActorBox.prototype,
	
	_onMouseClick: function(actor, event) {
		let dock = this._dock;
		if(event.get_button()==1) {
			let wsI = dock._box.getWSunderMousePos(global.get_pointer()[0] - this.actor.x);
			if(wsI != dock._box._currentWS)
				global.screen.get_workspace_by_index(wsI).activate(global.get_current_time());
			
			return;
		}
		else if(dock._menu || this._isHidden || event.get_button() != 3)
			return;
		
		dock._menu = new DockletMenu(dock);
	},
	get_boxMouse: function() {
		let m = global.get_pointer();
		
		return {x: m[1] - this.actor.y, y: m[0] - this.actor.x};
		//return {x: m[0] - this._calcDockX(this._dock._dockRealWidth), y: m[1] - this.actor.y}; //same result - but one less actor-property read -> better?
	},
	
	_setWSlabelPadding: function(s) {
		this._currentWSlabel.set_width(s);
	},
	_setWSnavigatorHeight: function(dockH) {
		let i = this._dock._CONF_wsNavigator_num,
			obj = this._wsNavigator,
			h = dockH - WS_NAVIGATOR_PADDING_Y*2;
			
		while(i--) {
			obj[i].set_width(h);
		}
	},
	_setDesktopButtonHeight: function(dockH) {
		this._desktopButton.set_width(dockH-2);
	},
	_setFavsSize: function(dockH) {
		let dock = this._dock,
			favs = this._smallFavs,
			i = favs.length,
			diff = dock._DATA_smallFav_width - dockH,
			x = dock._DATA_favsX_begin;
			
		
		while(i--) {
			Tweener.addTween(favs[i], {
				y: x,
				width: dockH,
				height: dockH,
				time: 0.3,
				transition: "easeInOutCubic"
			});
			x += dockH;
		}
		dock._group_space_left = x + GROUP_PADDING_LEFT;
		if(this._wsbg)
			this._wsbg.set_y(dock._group_space_left);
		this._extraContainer.set_height(x);
	},
	_setExtraBackHeight: function(dockH) {
		this._extraContainer.set_width(dockH);
	},
	
	_dock_lost_hover: function(actor, event) {
		let position = global.get_pointer(),
			dock = this._dock,
			x = this.actor.x,
			y = this._calcDockX(dock._dockRealWidth);
		
		if(position[0] < x || position[0] >= x+this.actor.width || position[1] < y || position[1] >= y+dock._dockRealWidth)
			return true;
		else
			return false;
	},
	_showDock: function() {
		if(this._hide_Timeout)
			Mainloop.source_remove(this._hide_Timeout);
		
		if(!this._isHidden)
			return;
		this._isHidden=false;
		
		let dock = this._dock;
		
		if(dock._CONF_showAllWS)
			this.listWS();
		else 
			Tweener.addTween(this.actor, {
					x: dock._dockY,
					opacity: 255,
					time: dock._CONF_showTime,
					transition: "easeOutQuad"
				});
	},
	_hideDock: function() {
		if(this._isHidden)
			return;
		this._isHidden=true;
		
		let dock = this._dock;
		
		if(dock._CONF_autohide && this._WSareListed)
			this.unlistWS();
		else {
			Tweener.addTween(this.actor, {
					x: dock._hideTo,
					opacity: dock._DATA_opacTo,
					time: dock._CONF_hideTime,
					transition: "easeOutQuad"
				});
		}
	},
	
	setDockHeight: function(s, correctBottomHeight, hide) {//this can be used for temporarely height-changes
		let dock = this._dock,
			yPos;
		if(s && s != dock._dockInnerHeight) {
			dock._dockInnerHeight = s;
			
			if(s<=dock._CONF_iconSize) {
				this.adjustButtons(s);
			}
		}
		else
			s = dock._dockInnerHeight;
		
		if(correctBottomHeight)
			yPos = dock._DATA_monitorStart - s - GROUP_PADDING_BOTTOM;
		else if(hide)
			yPos = dock._hideTo;
		else
			yPos = dock._dockY;
		
		
		
		Tweener.addTween(this.actor, {
				width: GROUP_PADDING_BOTTOM + s,
				x: yPos,
				opacity: hide ? dock._DATA_opacTo : 255,
				time: (hide ? dock._CONF_hideTime : dock._CONF_showTime),
				transition: "easeOutQuad"
			});
		
	},
	setDockWidth: function(w) {
		this._dock._dockRealWidth = w;
		Tweener.addTween(this.actor, {
				y: this._calcDockX(w),
				height: w,
				time: 0.3,
				transition: "easeInOutCubic"
			});
	},
	
	
	set_extraContainerY: function(y) {
		this._extraContainer.set_x(y);
	},
	set_wsbg_height: function(h) {
		if(h) {
			this._wsbg.show();
			this._wsbg.set_width(h - WS_LINES_SPACE_BETWEEN);
		}
		else
			this._wsbg.hide();
	},
	set_wsbg_widthY: function(w, y) {
		this._wsbg.set_x(y);
		this._wsbg.set_height(w);
	}
}


function workspaceBox(dock) {
	this._init(dock);
}
workspaceBox.prototype = {
	_init: function(dock) {
		this._dock = dock;
		
		this._currentWindowFocus = false;
		this._currentWsFocus = 0;
		this._workspaces = [];
		this._allWsWindows = 0;
		this._currentWS = global.screen.get_active_workspace_index();
		
		
		
		//Consider:
		//_CONF_onlyScreenWindows can be enabled without _CONF_onAllScreens enabled!
		//and _CONF_onlyScreenWindows can be disabled for primary-Docklet but not for others
		if(dock._monitorId == "primary" && (dock._CONF_onlyScreenWindows || dock._CONF_onAllScreens)) {
			this._ID_windowEnteredMonitor = global.screen.connect('window-entered-monitor', Lang.bind(this, this._onWindowEnteredMonitor));
			this._ID_windowLeftMonitor = global.screen.connect('window-left-monitor', Lang.bind(this, this._onWindowLeftMonitor));
		}
		
		this._ID_newWorkspace = global.screen.connect("notify::n-workspaces", Lang.bind(this, this._on_ws_changing));
		this._ID_switchWorkspace = global.window_manager.connect("switch-workspace", Lang.bind(this, this._changeWS));
		
		this._ID_minimize = global.window_manager.connect("minimize", Lang.bind(this, this._onMinimize));
		this._ID_map = global.window_manager.connect("map", Lang.bind(this, this._onMap));
		
		let tracker = Shell.WindowTracker.get_default();
		this._ID_focusApp = tracker.connect("notify::focus-app", Lang.bind(this, this._onFocus));
	},
	getWSunderMousePos: function(y) {
		let dock = this._dock,
			iconSize = dock._CONF_iconSize,
			isBottom = dock._CONF_dockY_type == BOTTOM,
			startY = (isBottom ? 0 : iconSize + dock._DATA_wsList_space),
			
			ws = this._workspaces,
			wsLast = dock.actorBox._calcNeededWSlen()-1,
			wsI;
		
		if(!dock.actorBox._WSareListed || y < startY || (isBottom && y > (wsLast)*iconSize)) //-1 -> because the last (free) ws is stripped off and would be in the first row
			wsI = this._currentWS;
		else {
			wsI = Math.floor((y - startY) / (iconSize + WS_LINES_SPACE_BETWEEN));
			if(wsI >= this._currentWS)
				++wsI;
			
			if(wsI > wsLast)
				wsI = wsLast;
			//else(wsI < 0) -> not necessary because of: if(... || y < startY || ...)
		}
		return wsI;
	},
	
	
	setRecordWS: function() {
		let dock = this._dock,
			ws = this._workspaces,
			i = ws.length,
			record = 0,
			recordClass = null,
			current_ws;
		while(i--) {
			current_ws = ws[i];
			if(current_ws._windows.length > record) {
				record = current_ws._windows.length;
				recordClass = current_ws;
			}
		}
		dock._winLenRecord = record;
		dock._winLenRecordClass = recordClass;
		if(dock._CONF_expandBox && dock.actorBox._WSareListed)
			dock.actorBox.setExpandedDockWidth(record, recordClass);
	},
	_indexAllWS: function() {
		let dock = this._dock,
			ws = this._workspaces,
			i = global.screen.n_workspaces;
		
		if(this._dock._CONF_showWSline)
			dock.actorBox._currentWSlabel.text = (global.screen.get_active_workspace_index()+1).toString();
		while(i--) {
			ws[i] = new windowBox(global.screen.get_workspace_by_index(i), this, dock);
		}
	},
	_on_ws_changing: function(ws) {
		//code-parts from: usr/share/gnome-shell/js/ui/main.js
		let dock = this._dock,
			oldNumWorkspaces = this._workspaces.length,
			newNumWorkspaces = global.screen.n_workspaces;
		
		if(newNumWorkspaces > oldNumWorkspaces) {
			// Assume workspaces are only added at the end
			for(let i = oldNumWorkspaces; i < newNumWorkspaces; ++i)
				this._workspaces[i] = new windowBox(global.screen.get_workspace_by_index(i), this, dock);
		}
		else if(newNumWorkspaces < oldNumWorkspaces){
			// Assume workspaces are only removed sequentially
			// (e.g. 2,3,4 - not 2,4,7)
			let removedNum = oldNumWorkspaces - newNumWorkspaces,
				removedIndex;
			for(let i=0; i < oldNumWorkspaces; ++i) {
				if(this._workspaces[i]._myWorkspace != global.screen.get_workspace_by_index(i)) {
					removedIndex = i;
					break;
				}
			}
			
			//let lostWorkspaces = this._workspaces.splice(removedIndex, removedNum); //will cause _destroy() disappear
			let i = removedIndex, max = i+removedNum
			for(; i<max; ++i) {
				this._workspaces[i]._destroy(i);
			}
			//if ws in middle has been removed, myWorkspace has to be corrected because ws have been moved downwards:
			for(max = this._workspaces.length; i<max; ++i) {
				this._workspaces[i]._myWorkspace = global.screen.get_workspace_by_index(i-removedNum);
			}
			
			this._workspaces.splice(removedIndex, removedNum);
			//same for currentWS, because indicis have changed
			if(this._currentWS >= removedIndex) {
				let from = this._currentWS;
				this._currentWS -= removedNum;
				if(dock._CONF_showWSline)
					dock.actorBox._currentWSlabel.text = (this._currentWS+1).toString();
				if(dock._CONF_showWSNavigator) {
					if(from < dock._CONF_wsNavigator_num)
						dock.actorBox._wsNavigator[from].remove_style_pseudo_class("focused");
					if(this._currentWS < dock._CONF_wsNavigator_num)
						dock.actorBox._wsNavigator[this._currentWS].add_style_pseudo_class("focused");
				}
			}
		}
		
		//no idea why this is necessary.
		//But multiple app-windows on different workspaces wont be recognized properly without reconnect...
		if(dock._monitorId == "primary") {
			let i = this._workspaces.length;
			while(i--) {
				this._workspaces[i]._removeListener();
				this._workspaces[i]._setListener();
			}
		}
		
		if(dock.actorBox._WSareListed) {
			dock.actorBox.unlistWS();
			dock.actorBox.listWS();
			if(!dock._CONF_autohide && dock._cutStrut) {
				let vars = dock._getStrutVars();
				
				dock._strut_height(vars[1]);
				if(dock._CONF_dockY_type == BOTTOM)
					dock._strut_y(vars[0]);
			}
		}
	},
	_changeWS: function(wm, from, to, direction) {
		this._currentWS = to;
		
		let dock = this._dock,
			actorBox = dock.actorBox,
			ws = this._workspaces,
			movesDown = (to>from) ? true : false,
			toWS = this._workspaces[to];
		
		
		if(dock._CONF_showWSline)
			actorBox._currentWSlabel.text = (to+1).toString();
		
		if(dock._CONF_showWSNavigator) {
			if(from < dock._CONF_wsNavigator_num)
				actorBox._wsNavigator[from].remove_style_pseudo_class("focused");
			if(to < dock._CONF_wsNavigator_num)
				actorBox._wsNavigator[to].add_style_pseudo_class("focused");
		}
		
		if(actorBox._WSareListed) {
			let confWSline = dock._CONF_showWSline,
				isBottom = (dock._CONF_dockY_type == BOTTOM),
				lineHeight = dock._CONF_iconSize + WS_LINES_SPACE_BETWEEN,
				startPos = (isBottom ? GROUP_PADDING_BOTTOM : dock._CONF_iconSize + dock._DATA_wsList_space),
				loop = (movesDown ? 1 : -1),
				dirPos = (movesDown ? 0 : 1),
				dockHeight;
			
			if(to==ws.length-1) {
				let labelPos = (to-1)*lineHeight + startPos;
				dockHeight = actorBox._calcListedHeight(to+1, lineHeight);
				
				actorBox.setDockHeight(dockHeight, isBottom);
				
				if(confWSline)
					actorBox.addWSlabel(to, labelPos);
			}
			else if(!movesDown && from==ws.length-1 && !ws[from]._windows.length) {
				dockHeight = actorBox._calcListedHeight(from, lineHeight);
				actorBox.setDockHeight(dockHeight, isBottom);
				
				if(confWSline)
					actorBox._wsLabels.pop().destroy();		
			}
			else
				dockHeight = actorBox._calcListedHeight(actorBox._calcNeededWSlen(), lineHeight);
			
			actorBox.set_wsbg_height(to*lineHeight);
			
			for(; from != to; from+=loop) {
				this._workspaces[from].moveIcons((from - dirPos) * lineHeight + startPos);
				if(confWSline) {
					let lable = actorBox._wsLabels[from - dirPos]
					if(lable)
						lable.text = (from+1)+":";
				}
			}
			if(isBottom) {
				let pos = actorBox._calcListedBottomPos(to, dockHeight);
				toWS.moveIcons(pos);
				if(actorBox._extraContainer)
					actorBox._extraContainer.set_y(pos);
			}
			else
				toWS.moveIcons(0);
		}
		else {
			ws[from].removeAllIcons(movesDown);
			toWS.activateIcons();
			
			toWS._updateHeight();
		
			if(dock._CONF_expandBox)
				actorBox.setExpandedDockWidth(toWS._windows.length, toWS);
		}
		
		if(dock._CONF_autohide) {
			if(this.noWindows_shown())
				dock.actorBox._showDock();
			else if(dock.actorBox._dock_lost_hover(dock.actor))
				dock.actorBox._hideDock();
		}
	},
	
	_onWindowEnteredMonitor: function(metaScreen, monitorI, metaWindow) {
		let tracker = Shell.WindowTracker.get_default(),
			app = tracker.get_window_app(metaWindow),
			wsI = metaWindow.get_workspace().index();
		if(!app || !tracker.is_window_interesting(metaWindow))
			return;
		
		//window has icon-property -> new window, which has just been added (or _CONF_onlyScreenWindows is false and it has been in box all along)
		if(this._dock._realMonitorId == monitorI) {
			if(!metaWindow.hasOwnProperty(this._dock._WIN_VAR_KEY_icon))
				this._workspaces[wsI].addWindow(app, metaWindow);
		}
		else if(this._dock._CONF_onAllScreens && !metaWindow.hasOwnProperty("PANEL_DOCKLET_icon"+monitorI)) {
			let sDock = this._dock._secondaryPanelDocklets[monitorI];
			if(sDock)
					//it seems that, when monitors are changed, before the connectors for "monitor changed" are called,
					//monitors are changed AND windows get moved.
					//Workaround: just do nothing and wait for recreating of all the boxes...
				sDock._box._workspaces[wsI].addWindow(app, metaWindow);
		}
	},
	_onWindowLeftMonitor: function(metaScreen, monitorI, metaWindow) {
		let iconPrimary = metaWindow[this._dock._WIN_VAR_KEY_icon],
			icon = metaWindow["PANEL_DOCKLET_icon"+monitorI],
			ws = metaWindow.get_workspace(),
			wsI;
		if(!ws) //window has just been closed
			return;
		wsI = ws.index();
		
		if(this._dock._realMonitorId == monitorI) {
			if(iconPrimary && this._dock._CONF_onlyScreenWindows)//no icon -> unimportant window-> not in (any) box; _CONF_onlyScreenWindows==false -> no need to remove
				this._workspaces[wsI].removeWindow(metaWindow, iconPrimary);
		}
		else if(this._dock._CONF_onAllScreens && icon) {
			let secBox = this._dock._secondaryPanelDocklets[monitorI];
			if(secBox._CONF_onlyScreenWindows)
				secBox._box._workspaces[wsI].removeWindow(metaWindow, icon);
		}
	},
	_onFocus: function() {
		let win = global.display.focus_window,
			icon;
		
		if(win && (icon = win[this._dock._WIN_VAR_KEY_icon])) {
			//we just want to focus the current workspace to prevent some trouble
			let wsI = win.get_workspace().index();
			icon.showFocused(wsI, this._dock._CONF_onlyOneIcon ? win : false);
			
			if(this._currentWindowFocus)
				this._currentWindowFocus.removeFocus(icon, this._currentWsFocus);
			this._currentWindowFocus = icon;
			this._currentWsFocus = wsI
		}
		else if(this._currentWindowFocus) {
			this._currentWindowFocus.removeFocus(this._currentWsFocus);
			this._currentWindowFocus = false;
		}
	},
	_onMinimize: function(shellwm, actor) {
		let a = actor.get_meta_window();
		
		if((a=a[this._dock._WIN_VAR_KEY_icon]))
			a.showMinimized();
	},
	_onMap: function(shellwm, actor) {
		let a;
		if((a=actor.get_meta_window()[this._dock._WIN_VAR_KEY_icon]))
			a.showMaped();
	},
	
	noWindows_shown: function() {
		return !this._workspaces[this._currentWS].shownWindows;
	},
	
	_destroy: function() {
		global.screen.disconnect(this._ID_newWorkspace);
		global.window_manager.disconnect(this._ID_switchWorkspace);
		global.window_manager.disconnect(this._ID_minimize);
		global.window_manager.disconnect(this._ID_map);
		Shell.WindowTracker.get_default().disconnect(this._ID_focusApp);
		
		if(this._ID_windowEnteredMonitor) {
			global.screen.disconnect(this._ID_windowEnteredMonitor);
			global.screen.disconnect(this._ID_windowLeftMonitor);
			this._ID_windowEnteredMonitor = false;
		}
		
		let i = this._workspaces.length;
		while(i--) {
			this._workspaces[i]._destroy(i);
		}
	}
}


function windowBox(ws, wsBox, dock) {
	this._init(ws, wsBox, dock);
}
windowBox.prototype = {
	_init: function(ws, wsBox, dock) {
		this._dock = dock;
		this._myWorkspace = ws;
		this._wsBox = wsBox;
		this._windows = [];
		this._winIcon = dock._CONF_rotated ? Y_windowIconButon : X_windowIconButon;
		this._isListedTo = dock._DATA_icons_ListedTo_default;
		this.shownWindows = 0;
		
		this._iconSize = dock._CONF_iconSize;
		this._buttonWidth = dock._CONF_showWindowTitle ? dock._CONF_buttonMaxWidth : dock._CONF_iconSize;
		this._showLabel = dock._CONF_showWindowTitle;
		this.nextWindowPosition = -1; //for dragging to other ws
		
		this._ID_windowAdded = false;
		this._ID_windowRemoved = false;
		
		
		this._indexAllWindows();
		if(dock._monitorId == "primary") {
			this._setListener();
		}
	},
	
	_indexAllWindows: function() {
		let myWS = this._myWorkspace,
			wins = this._myWorkspace.list_windows(),
			i = wins.length,
			win;
		
		if(this._dock._CONF_windowFavs)
			this._loadFavorites();
		
		while(i--) {
			win = wins[i]
			this._onWindowAdded(myWS, win);
			//check for focus happens in WinItem-class
		}
	},
	_setListener: function() {
		let ws = this._myWorkspace;
		this._ID_windowAdded = ws.connect("window-added", Lang.bind(this, this._onWindowAdded));
		this._ID_windowRemoved = ws.connect("window-removed", Lang.bind(this, this._onWindowRemoved));
	},
	_removeListener: function() {
		if(this._ID_windowAdded) { 
			let ws = this._myWorkspace;
			ws.disconnect(this._ID_windowAdded);
			ws.disconnect(this._ID_windowRemoved);
			this._ID_windowAdded = false;
		}
	},
	listAllWindows: function(into, source, toHeight) {
		let windows = source._myApp.get_windows(),
			i = windows.length;
		if (!i)
			return false;
		//Asuming: fewer windows -> effectiveness of counting sort
		
		let enableTexture = this._dock._CONF_windowTexture,
			winVarKey_icon = this._dock._WIN_VAR_KEY_icon,
			wsI = 0, //notice the ++wsI ! Will only be 0 for current ws
			currentWS = this._wsBox._currentWS,
			loopWS = null,
			sortA = [[]], //first one is not allways initated - if so, second one is and length will be 1
			freeMonitorH = this._dock._getMonitor().height-200, //200: space for menus and so..
			wsOpac = 255,
			win, t, j,
			itemGroup, box, item, style, size, w, h,
			list_item_dragOver= function() {
				this._myWindow.activate(global.get_current_time());
			};
		
		//if there are unimportant or ignored windows, size can be cut without need. I am overlooking that:
		if(enableTexture && toHeight*i > freeMonitorH)
			toHeight = freeMonitorH/i;
		
		
		while(i--) {
			win = windows[i];
			if(win.get_workspace() != loopWS) {
				loopWS = win.get_workspace();
				sortA[(loopWS.index() == currentWS) ? (wsI=0) : ++wsI] = [];
			}
			if(win.hasOwnProperty(winVarKey_icon))//can be false, when its on other screen and ignored or unimportant
				sortA[wsI][win.get_stable_sequence()] = win; //not the docklet-order, but when _CONF_onlyOneIcon is enabled it would get difficult
				//sortA[wsI].push(win); //no order, but fast
		}
		
		//because of while: i == -1
		for(let max = sortA.length; ++i < max;) {
			t = sortA[i];
			j = t.length;
			
			while(j--) {
				win = t[j];
				if(!win)
					continue;
					
				style = (win.minimized ? "winLine minimizedOne" : "winLine");
				if(win.has_focus())
					style += " focusedOne";
				if(source._myWindow == win)
					style += " chosenOne";
				
				
				if(enableTexture) {
					itemGroup = new PopupMenu.PopupBaseMenuItem({style_class: style});
					item = new Clutter.Clone({source: win.get_compositor_private().get_texture()});
					
					size = win.get_outer_rect();
					if(size.width > size.height)
						item.set_size(w = toHeight, h = Math.round(size.height / (size.width / toHeight))); //Variables are set here!
					else
						item.set_size(w = Math.round(size.width / (size.height / toHeight)), h = toHeight); //Variables are set here!
					
					itemGroup.actor.set_height(toHeight);
					
					box = new St.BoxLayout();
					box.add(item);
					box.add(new St.Label({ text: win.title, x:5, y:h-21, width: w-10, style_class: "windowTexture_label", opacity:210}));
					itemGroup.addActor(box);
				}
				else {
					itemGroup = new PopupMenu.PopupMenuItem(win.title, {style_class: style});
					itemGroup.setShowDot(true);
				}
				
				itemGroup.actor.opacity = wsOpac;
				itemGroup.handleDragOver = list_item_dragOver;
				itemGroup._myWindow = win;
				into.addMenuItem(itemGroup);
			}
			
			if(i)
				into.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
			else
				wsOpac = 100; //first run is allways current ws
		}
		return true;
	},
	_loadFavorites: function() {
		let apps = this._dock._favCache,
			i = apps.length,
			app;
		while(i--) {
			app = apps[i];
			this.addWindow(app, new FavWindow(app, this._dock));
		}
	},
	
	_onWindowAdded: function(metaWorkspace, metaWindow) {
		let monitorI = metaWindow.get_monitor(),
			tracker = Shell.WindowTracker.get_default(),
			app = tracker.get_window_app(metaWindow);
		if(!app || !tracker.is_window_interesting(metaWindow))
			return;
		
		if(this._dock.is_on_my_monitor(monitorI))
			this.addWindow(app, metaWindow);
		
		if(this._dock._CONF_onAllScreens)
			this._add_to_all_monitors(app, metaWindow, metaWorkspace.index(), monitorI);
	},
	
	_onWindowRemoved: function(metaWorkspace, metaWindow) {
		let monitorI = metaWindow.get_monitor(),
			icon = metaWindow[this._dock._WIN_VAR_KEY_icon];
	
		if(icon && this._dock.is_on_my_monitor(monitorI))
			this.removeWindow(metaWindow, icon);
		
		if(this._dock._CONF_onAllScreens)
			this._remove_from_all_monitors(metaWindow, metaWorkspace.index(), monitorI);
	},
	
	
	
	addWindow: function(app, win, isDouble) {
		let dock = this._dock;
		
		if(dock._CONF_onlyOneIcon) {
			let wins = this._windows,
				i = wins.length,
				item;
			while(i--) {
				item = wins[i];
				if(item._myApp == app) {
					item.addAppWindow(win, isDouble || false);
					return item;
				}
			}
		}
		
		let item = new this._winIcon(
				dock,
				app,
				win,
				this,
				this._windows.length, //index-count is current index
				this._iconSize,
				this._buttonWidth,
				this._isListedTo + ((this._myWorkspace.index() > this._wsBox._currentWS) ? this._iconSize : -this._iconSize),
				isDouble || false
			);
		
		if(this._showLabel)
			item.addLabel();
		
		if(dock.actorBox._WSareListed || this._myWorkspace.index() == dock._box._currentWS)
			item.insertIcon(this._isListedTo);
		
		this._windows.push(item);
		
		if(dock._CONF_expandBox && this._windows.length > dock._winLenRecord) {
			dock._winLenRecord = this._windows.length;
			dock._winLenRecordClass = this;
		}
		
		if(this.nextWindowPosition != -1) {
			item._swapTo(this.nextWindowPosition);
			this.nextWindowPosition = -1;
		}
		else if(dock._CONF_orderIcons && app.get_windows().length > 1) {
			let wins = this._windows,
				i = wins.length-1; //-1: last one is itself
			while(i--) {
				if(wins[i]._myApp == app) {
					if(++i != item._myIndex) //++i: right of
						item._swapTo(i);
					break;
				}
			}
		}
		this._updateIconSize(); //has to be called AFTER ordering
		
		return item;
	},
	removeWindow: function(win, icon) {
		icon.request_total_destroy(win);
		if(this._wsBox._currentWindowFocus == icon)
			this._wsBox._currentWindowFocus = false; //needs to be after request_total_destroy()
		
		if(this._dock._CONF_expandBox && this == this._dock._winLenRecordClass)
			this._wsBox.setRecordWS();
		
		this._updateIconSize();
	},
	_add_to_all_monitors: function(app, rwindow, wsI, mI) {
		let monitors = this._dock._secondaryPanelDocklets,
			i = monitors.length,
			m, ws;
		
		while(i--) {
			m = monitors[i];
			//monitors can have different workspaces.length (or at least the last can get stripped if empty)
			if(m && m.is_on_my_monitor(mI) && (ws=m._box._workspaces[wsI]) && !rwindow.hasOwnProperty(m._WIN_VAR_KEY_icon)) {
				ws.addWindow(app, rwindow);
			}
		}
	},
	_remove_from_all_monitors: function(rwindow, wsI, mI) {
		let secBoxes = this._dock._secondaryPanelDocklets,
			i = secBoxes.length,
			m, ws, icon;
		
		while(i--) {
			m = secBoxes[i];
			//monitors can have different workspaces.length (or at least the last can get stripped)
			if(m && m.is_on_my_monitor(mI) && (ws=m._box._workspaces[wsI]) && (icon=rwindow[m._WIN_VAR_KEY_icon]))
				ws.removeWindow(rwindow, icon);
		}
	},
	
	activateIcons: function(yPos) {
		this._isListedTo = yPos || this._dock._DATA_icons_ListedTo_default;
		
		let iconSize = this._iconSize,
			buttonWidth = this._buttonWidth,
			i = this._windows.length,
			win;
		
		while(i--) {
			(win = this._windows[i]).insertIcon(yPos);
		}
	},
	removeAllIcons: function(movesUp, noAnimation) {
		if(this._isListedTo)
			this._isListedTo = 0;
		
		let i = this._windows.length,
			win;
		
		while(i--) {
			win = this._windows[i];
			
			win.removeIcon(movesUp, noAnimation);
		}
	},
	moveIcons: function(y) {
		this._isListedTo = y;
		
		let i = this._windows.length;
		
		while(i--) {
			this._windows[i].setY(y);
		}
	},
	zoomIcons: function(x) {
		let iconSize = this._iconSize,
			buttonWidth = this._buttonWidth,
			wideness = (buttonWidth/iconSize) * 3, //more icons are affected
			maxSize = Math.round(iconSize/2),
			y = (this._dock._CONF_dockY_type == BOTTOM) ? this._isListedTo : false,
			wins = this._windows,
			i = wins.length;
		
		x -= buttonWidth/2; //because button-pos doesnt start in the middle
		while(i--) {
			wins[i].zoomTo(x, y, iconSize, buttonWidth, wideness, maxSize);
		}
	},
	undoIconsZoom: function() {
		let iconSize = this._iconSize,
			buttonWidth = this._buttonWidth,
			isListedTo = this._isListedTo,
			wins = this._windows,
			i = wins.length;
		
		while(i--) {
			wins[i].undoZoom(iconSize, buttonWidth, isListedTo);
		}
	},
	reloadAllLabels: function(showLabel) {//for conf-update
		this._showLabel = showLabel;
		let i = this._windows.length,
			win;
		while(i--) {
			win = this._windows[i];
			win.destroyLabel();
			if(showLabel)
				win.addLabel();
		}
	},
	_setIconSize: function(l) {
		let dock = this._dock,
			//when box is full, Math.floor will cause free space at the right, but it prevents blured icons:
			s = ((l > dock._DATA_max_icons)
					? (dock._CONF_smallFavs
							? Math.floor((dock._DATA_padding_x_sum+dock._DATA_inner_width - dock._DATA_favsX_begin - dock._DATA_group_space_right) / (l+dock._favCache.length))
							: Math.floor(dock._DATA_inner_width / l)
						)
					: dock._CONF_iconSize
				),
			i = l,
			realIconSize = s - ICON_PADDING_SUM;
			
			this._iconSize = s;
			this._buttonWidth = s;
			
			if(!dock.actorBox._WSareListed && this._wsBox._currentWS == this._myWorkspace.index())
				this._updateHeight(s);
			else if(dock._CONF_dockY_type == BOTTOM && dock._box._currentWS == this._myWorkspace.index())
				this.moveIcons(this._dock.actorBox._calcListedBottomPos(this._myWorkspace.index(), s));
			
			while(i--) {
				this._windows[i].change_size(s, s, realIconSize);
			}
	},
	_setButtonSize: function(l) {
		let dock = this._dock,
			i = l,
			w = (l <= dock._DATA_max_buttons) ? dock._CONF_buttonMaxWidth : Math.floor(dock._DATA_inner_width / l),
			h = this._iconSize,
			iconSize = h - ICON_PADDING_SUM,
			hasLabel = (w >= dock._DATA_iconLabel_minWidth);
		
		this._buttonWidth = w; //will be used by _calcX() - has to be set before loop!
		
		
		//FIXME: no if in loop, but...
		if(this._showLabel && !hasLabel)
			while(i--) {
				this._windows[i].change_size(w, h, iconSize);
				this._windows[i].removeLabel();
			}
		else if(!this._showLabel && hasLabel)
			while(i--) {
				this._windows[i].change_size(w, h, iconSize);
				this._windows[i].addLabel();
			}
		else
			while(i--) {
				this._windows[i].change_size(w, h, iconSize);
			}
		
		this._showLabel = hasLabel;
	},
	_updateIconSize: function() {
		let l = this._windows.length,
			dock = this._dock;
		
		if(dock._CONF_expandBox) {
			if(dock._box._currentWS == this._myWorkspace.index())
				dock.actorBox.setExpandedDockWidth(l, this);
		}
		else if(l >= dock._DATA_max_icons)
			this._setIconSize(l);
		
		else if(dock._CONF_showWindowTitle && l >= dock._DATA_max_buttons)
			this._setButtonSize(l);
	},
	_updateHeight: function(s) {//here, fixed height can be set. It also alters values for calculations
		s = s || this._iconSize;
		let dock = this._dock;
		
		if(dock._CONF_dockY_type == BOTTOM) {
			dock._dockY = dock._DATA_monitorStart - s - GROUP_PADDING_BOTTOM;
			if(s<dock._CONF_dontHideSize)
				dock._hideTo = dock._dockY;
		}
		else
			dock._hideTo = ((s<dock._CONF_dontHideSize) ? dock._dockY : dock._dockY + dock._CONF_dontHideSize - s); //dock._dockY is normally 0, but not if hotCorners are saved
		
		dock.actorBox.setDockHeight(s, false, dock.actorBox._isHidden);
	},
	
	//FIXME: check for autohide instead of "disabling function when autohide disabled
	inc_shownWindows: function() {
		if(this._dock._CONF_autohide && !(this.shownWindows++) && this._myWorkspace.index() == this._wsBox._currentWS)
			this._dock.actorBox._hideDock();
	},
	dec_shownWindows: function() {
		if(this._dock._CONF_autohide && !(--this.shownWindows) && this._myWorkspace.index() == this._wsBox._currentWS)
			this._dock.actorBox._showDock();
	},
	
	_destroy: function(wsI) {
		this._removeListener();
		let wins = this._windows,
			i = wins.length;
		
		//if only one ws is destroyed, we have to be carefull, which flag we remove or awsWins will be lost too
		while(i--) {
			wins[i].remove_from_one_workspace(wsI);
		}
	}
}


function windowIconButton(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble) {
	this._init(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble);
}
windowIconButton.prototype = {
	_init: function(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble) {
		this._dock = dock;
		this._myWindow = window;
		this._myWindowClass = windowClass;
		if(dock._CONF_onlyOneIcon) {
			this._myAppWindows = [window];
			this._awsWins = [];//is only used by Double-leader
		}
		this._myApp = app;
		this._myIndex = i;
		this._myDoubles = []; //link icons to other workspaces for same window
		this._group = false;
		this._icon = false;
		this._label = false;
		this._labelIsAdded = false;
		this._numLabel = false;
		this._wantsAttention = false;
		this._isMinimized = false;
		
		this.change_x = this._set_x;
		this.change_size = this._set_size;
		
		this._createIcon(iconSize, buttonWidth, ypos);
		this._actor_state = STATE.REMOVED;
		
		if(!isDouble && this._flag_window(window)) {
			if(window.is_on_all_workspaces()) {
				this._is_awsWin = true;
				this.add_to_all_workspaces(windowClass._myWorkspace.index());
			}
			else
				this._is_awsWin = false;
		}
		else {
			this._is_awsWin = true;//doubles are only created for awsWins
		}
	},
	_calcX: function() {//will be called everytime x has to change (except zoom)
		return this._dock._group_space_left + this._myIndex*this._myWindowClass._buttonWidth;
	},
	_flag_window: function(rwin) {
		if(rwin.hasOwnProperty(this._dock._WIN_VAR_KEY_icon)) {//when new ws is created - it becomes a double
			rwin[this._dock._WIN_VAR_KEY_icon]._myDoubles[this._myWindowClass._myWorkspace.index()] = this;
			return false;
		}
		else {
			rwin[this._dock._WIN_VAR_KEY_icon] = this;
			return true;
		}
	},
	
	addAppWindow: function(rwin, isDouble) {
		this._myAppWindows.push(rwin);
		if(isDouble || !this._flag_window(rwin)) {
			this._awsWins.push(rwin);
			this._is_awsWin = true;
		}
		if(rwin != this._myWindow)
			this._changeGroupLeader(rwin);//isDouble will be calced again...
		
		this._showWindowStats();
		
		if(this._dock._CONF_windowNumber) {
			let t = this._myAppWindows.length;
			if(this._myAppWindows[0].hasOwnProperty("justA_favWindow"))
				--t;
			
			if(this._numLabel)
				this._numLabel.text = t.toString();
			else if(t > 1)
				this._createNumber(t.toString());
		}
	},
	
	_changeGroupLeader: function(rwin) {
		this._is_awsWin = this._marked_as_awsWin(rwin);
		
		if(this._label) {
			this._myWindow.disconnect(this._ID_titleChanged);
			this._ID_titleChanged = rwin.connect("notify::title", Lang.bind(this, function() {this._label.text = this._myWindow.title;}));
			this._myWindow = rwin;
			this._label.text = this._myWindow.title;
		}
		else
			this._myWindow = rwin;//has to be changed after disconnect
	},
	
	_createNumber: function(t) {
		this._numLabel = new St.Label({
				text: t,
				style_class: "windowNumber",
				x: -ICON_PADDING_TOP,
				y: -ICON_PADDING_TOP
			});
		this._group.add(this._numLabel);
	},
	_calcNumber: function() {
		if(this._myWindow.hasOwnProperty("justA_favWindow")) {
			if(!this._dock._CONF_smartWindowNumber)
				this._createNumber("0");
		}
		else if(this._dock._CONF_onlyOneIcon) {
			if(!this._dock._CONF_smartWindowNumber)
				this._createNumber("1");
		}
		else {
			let t = this._myApp.get_windows().length;
			if(!this._dock._CONF_smartWindowNumber || t>1)
				this._createNumber(t.toString());
		}
	},
	
	addLabel: function() {
		if(!this._label)
			this.createLabel();
		
		this._group.add(this._label);
		this._labelIsAdded = true;
	},
	removeLabel: function() {
		if(!this._labelIsAdded)
			return;
		this._group.remove_actor(this._label);
		this._labelIsAdded = false;
	},
	destroyLabel: function() {
		if(this._label) {
			this._label.destroy();
			this._label = false;
			this._labelIsAdded = false;
			
			this._group.remove_style_class_name("labled_background");
			
			this._myWindow.disconnect(this._ID_titleChanged);
		}
		this._labelIsAdded = false;
	},
	
	_onMouseClick: function(actor, event) {
		let button = event.get_button(),
			dock = this._dock;
		switch(button) {
			case 1://left
				let f;
				if(dock._box._currentWS == this._myWindowClass._myWorkspace.index()
						&& (this._myWindow.has_focus() || (dock._CONF_onlyOneIcon && (f=dock._box._currentWindowFocus) && f._myApp == this._myApp)))
					this.doMinimize();
				else
					this.doMap();
				
				if(dock._menu)
					dock._menu._destroy();
			break;
			case 2://middle
				switch(this._dock._CONF_middleClick) {
					case MINIMIZE_WINDOW:
						this.doMinimize();
					break;
					case NEW_WINDOW:
						this.doNew();
					break;
					case CLOSE_WINDOW:
						this.doClose();
					break;
					case QUIT_APP:
						this.doQuit();
					break;
				}
			break;
			case 3://right
				if(dock._menu || dock.actorBox._isHidden)
					return;
				
				dock._menu = new IconMenu(this);
		}
	},
	_startDrag: function() {
		if(this._dock._menu)
			this._dock._menu._destroy(true);
		this._dock.hideWindowList();
		
		this.actor.opacity = 60;
		
		this._dragMonitor = {
				dragMotion: Lang.bind(this, this._onDragMotion)
			};
		DND.addDragMonitor(this._dragMonitor);
		
		let item = this._dock._dragPointer;
		item.set_position(this.actor.x, this.actor.y);
		this._dock.actor.add(item);
		
		this._dragState = true;
	},
	_endDrag: function() {
		if(!this._dragState)
			return;
		this._dragState = false;
		
		DND.removeDragMonitor(this._dragMonitor);
		
		this._dock.actor.remove_actor(this._dock._dragPointer);
		
		if(this._actor_state != STATE.INSERTED) //happens, when WS is changed
			return;
		
		Tweener.addTween(this.actor, {
				opacity: 255,
				time: 0.3,
				transition: "easeInOutCubic",
			});
	},
	_onDragMotion: function() {
		//I could get the mouse-pos through the handed function-var. But I need to use get_boxMouse() for left/right-support
		let dock = this._dock,
			current_wsI = this._myWindowClass._myWorkspace.index(),
			pointer = dock._dragPointer,
			drag = dock.actorBox.get_boxMouse(),
		
			startY = ((dock._CONF_dockY_type == BOTTOM) ? 0 : dock._CONF_iconSize + dock._DATA_wsList_space),
			wsI = dock._box.getWSunderMousePos(drag.y),
			winBox = dock._box._workspaces[wsI],
			winI = Math.floor((drag.x-dock._group_space_left) / winBox._buttonWidth),
			winLe = winBox._windows.length;
		
		winI = Math.max(Math.min(winI, (wsI == current_wsI) ? winLe-1 : winLe), 0);
		
		if(wsI == current_wsI && winI != this._myIndex) {
			this._dragMonitor.dragDrop = Lang.bind(this, function(event) {
					event.dropActor.hide();
					
					this._swapTo(winI);
					
					return DND.DragDropResult.CONTINUE;
				});
		}
		else if(wsI != current_wsI && !this._myWindow.is_on_all_workspaces()) {
			this._dragMonitor.dragDrop = Lang.bind(this, function(event) {
					event.dropActor.hide();
					
					let wins = winBox._windows,
						l = wins.length;
					
					if(winI < l)
						winBox.nextWindowPosition = winI;
					if(dock._CONF_onlyOneIcon) {
						let ct = global.get_current_time(),
							aWins = this._myAppWindows,
							i = aWins.length;
						
						while(i--) {
							aWins[i].change_workspace_by_index(
									wsI,
									false, // don't create workspace
									ct
								);
						}
					}
					else
						this._myWindow.change_workspace_by_index(
								wsI,
								false, // don't create workspace
								global.get_current_time()
							);
					
					return DND.DragDropResult.CONTINUE;
				});
			
		}
		else {
			this._dragMonitor.dragDrop = false;
			
			pointer.set_position(this.actor.x, this.actor.y);
			pointer.set_size(this.actor.width, this.actor.height);
			
			return DND.DragMotionResult.NO_DROP;
		}
		
		
		if(this._dragMonitor.dragDrop) {
			if(winI < winLe) {
				let actor = winBox._windows[winI].actor;
				
				pointer.set_position(actor.x, actor.y);
				pointer.set_size(actor.width, actor.height);
			}
			else {
				let w = winBox._buttonWidth;
				
				if(dock._CONF_rotated) {
					pointer.set_position(winBox._isListedTo, dock._group_space_left + winLe*w - w/2);
					pointer.set_size(winBox._iconSize, w);
				}
				else {
					pointer.set_position(dock._group_space_left + winLe*w - w/2, winBox._isListedTo);
					pointer.set_size(w, winBox._iconSize);
				}
			}
			return DND.DragMotionResult.MOVE_DROP;
		}
		else
			return DND.DragMotionResult.CONTINUE;
	},
	getDragActor: function() {
		return new Clutter.Clone({ source: this.actor, opacity:180 });
	},
	getDragActorSource: function() {
		return this.actor;
	},
	handleDragOver: function(source, actor, eventX, eventY, time) { //just for xdnd-drag
		if(this._dock._CONF_onlyOneIcon && this._myApp.get_windows().length>1) {
			this.openList();
		}
		else if(!this._myWindow.has_focus() && !this._myWindow.hasOwnProperty("justA_favWindow")) {
			this._dock.hideWindowList();
			this.doMap();
		}
    },
	_check_openList: function() {
		if(!this._dock._windowList_timeout/* && (!this._dock._CONF_autohide || !this._dock.actorBox._isHidden)*/)
			this._dock._windowList_timeout = Mainloop.timeout_add(this._dock._CONF_hoverTimeout, Lang.bind(this, this.openList));
	},
	
	_swapTo: function(toI) {
		let wins = this._myWindowClass._windows;
		
		if(toI < this._myIndex) //left from mouse
			this._moveOthersRight(wins, toI);
		else//right from mouse
			this._moveOthersLeft(wins, toI);
		
		wins[toI] = this;
		this._myIndex = toI;
		this._set_x();
	},
	_moveOthersRight: function(wins, toI) {
		for(let i=this._myIndex-1; i >= toI; --i) {
			wins[i+1] = wins[i];
			++wins[i]._myIndex;
			wins[i].change_x();
		}
	},
	_moveOthersLeft: function(wins, toI) {
		for(let i=this._myIndex+1; i <= toI; ++i) {
			wins[i-1] = wins[i];
			--wins[i]._myIndex;
			wins[i].change_x();
		}
	},
	
	doMinimize: function() {
		if(this._dock._CONF_onlyOneIcon) {
			let wins = this._myAppWindows,
				i = wins.length;
			while(i--) {
				wins[i].minimize();
			}
		}
		else
			this._myWindow.minimize();
	},
	doMap: function() {
		let ws = this._myWindowClass._myWorkspace;
		if(ws != global.screen.get_active_workspace())
			ws.activate(global.get_current_time());
		
		if(this._dock._CONF_onlyOneIcon)
			this._myApp.activate(global.get_current_time());
		else
			this._myWindow.activate(global.get_current_time());
		
		if(Main.overview.visible)
			Main.overview.hide();
	},
	doNew: function() {
		this._myApp.open_new_window(this._dock._box._currentWS);
	},
	doClose: function() {
		if(this._dock._windowList_current)
			this._dock.hideWindowList();
		this._myWindow.delete(global.get_current_time());
	},
	doQuit: function() {
		this._myApp.request_quit();
	},
	
	_throughDoubles:function(i) {
		return this._myDoubles[i] || this;
	},
	_showWindowStats: function() {
		let wsI = this._myWindowClass._myWorkspace.index();
		if(this._myWindow.has_focus() && this._dock._box._currentWS == wsI) {
			//dont use showFocused(), or prevent check for awsWin -> if awsWin==true -> infinite loop:
			this.actor.add_style_pseudo_class("focused");
			
			this._dock._box._currentWindowFocus = this;
			this._dock._box._currentWsFocus = wsI;
		}
		if(this._myWindow.minimized)
			this.showMinimized();
		else if(!this._myWindow.hasOwnProperty("justA_favWindow"))
			this._myWindowClass.inc_shownWindows();
	},
	showFocused: function(wsI, rwin) {
		let icon = this._throughDoubles(wsI);
		if(rwin && rwin != icon._myWindow) //we only get a rwin, when _CONF_onlyOneIcon is enabled
			icon._changeGroupLeader(rwin);
			
		this._check_for_awsWin(icon, wsI);
		
		icon.actor.add_style_pseudo_class("focused");
		if(this._wantsAttention) {
			icon.actor.remove_style_pseudo_class("attention");
			this._wantsAttention = false;
		}
	},
	removeFocus: function(wsI) {
		let icon = this._throughDoubles(wsI);
		
		this._check_for_awsWin(icon, wsI);
		
		icon.actor.remove_style_pseudo_class("focused");
	},
	showMinimized: function() {
		if(!this._isMinimized) {
			this._isMinimized = true;
			if(this.all_are_minimized())
				this._group.opacity = ICON_MINIMIZED_OPACITY;
			
			let doubles = this._myDoubles,
				i = doubles.length,
				d;
			while(i--) {
				if((d = doubles[i]) && d.all_are_minimized())
					d._group.opacity = ICON_MINIMIZED_OPACITY;
			}
			
			if(!this._myWindow.hasOwnProperty("justA_favWindow"))
				this._myWindowClass.dec_shownWindows();
		}
	},
	showMaped: function() {
		if(this._isMinimized) {
			this._isMinimized = false;
			this._group.opacity = 255;
			
			let doubles = this._myDoubles,
				i = doubles.length,
				d;
			while(i--) {
				if((d = doubles[i]))
					d._group.opacity = 255;
			}
			if(!this._myWindow.hasOwnProperty("justA_favWindow"))
				this._myWindowClass.inc_shownWindows();
		}
	},
	showAttention: function(wsI) {
		let icon = this._throughDoubles(wsI);
		icon.actor.add_style_pseudo_class("attention");
		this._wantsAttention = true;
	},
	all_are_minimized: function() {
		if(!this._dock._CONF_onlyOneIcon)
			return true;
		
		let wins = this._myAppWindows,
			i = wins.length;
		while(i--)  {
			if(!wins[i].minimized && !wins[i].hasOwnProperty("justA_favWindow"))
				return false;
		}
		return true
	},
	_check_for_awsWin: function(toIcon, wsI) {
		if(this._myWindow.is_on_all_workspaces()) {
			if(!this._is_awsWin)
				this.add_to_all_workspaces(wsI);
		}
		else if(this._is_awsWin)
			this.remove_from_all_workspaces(this._myWindow, toIcon, wsI);
	},
	_marked_as_awsWin: function(rwin) {
		let wins = this._awsWins,
			i=wins.length;
		while(i--) {
			if(wins[i] == rwin)
				return true;
		}
		return false;
	},
	_get_awsWin_marker: function(rwin) {
		let wins = this._awsWins,
			i=wins.length;
		while(i--) {
			if(wins[i] == rwin)
				return i;
		}
		return -1;//this should never happen!
	},
	
	add_to_all_workspaces: function(my_wsI) {
		let winClass = this._myWindowClass,
			wsClass = winClass._wsBox,
			ws = wsClass._workspaces,
			i = ws.length;
		
		++wsClass._allWsWindows;
		this._is_awsWin = true;
		if(this._dock._CONF_onlyOneIcon)
			this._awsWins.push(this._myWindow);
		this._myDoubles = [];
		while(i--) {
			if(i != my_wsI)//or itself wil be doubled
				this._myDoubles[i] = ws[i].addWindow(this._myApp, this._myWindow, true);
		}
		this._myDoubles[my_wsI] = false;//otherwise .length would be confused
		
		if(this._dock.actorBox._WSareListed) {
			this._dock.actorBox.unlistWS();
			this._dock.actorBox.listWS();
		}
	},
	remove_from_all_workspaces: function(rwin, toIcon, wsI) {
		let wins = this._myDoubles,
			i = wins.length;
		
		--this._dock._box._allWsWindows;
		while(i--) {
			if(wins[i])//not all elements must be set
				wins[i].request_single_destroy(rwin);
		}
		
		if(toIcon && this != toIcon) {//add the window to another ws in prozess
			//toIcon.myDouble is an empty array and toIcon._is_awsWin is true, since its a double
			
			this._myDoubles[wsI] = this;//goal-window is removed from list and itself will be removed instead
			this._myWindow[this._dock._WIN_VAR_KEY_icon] = toIcon;
			if(this._dock._CONF_onlyOneIcon) {
				toIcon._myAppWindows = this._myAppWindows;
				toIcon._awsWins = this._awsWins;
				toIcon._awsWins.splice(toIcon._get_awsWin_marker(rwin), 1);//anyway, at this point: toIcon._awsWins == this._awsWins
				if(!toIcon._awsWins.length)
					toIcon._is_awsWin = false;
				else
					toIcon._myDoubles = this._myDoubles;
			}
			else 
				toIcon._is_awsWin = false;
		}
		else {
			if(this._dock._CONF_onlyOneIcon) {
				this._awsWins.splice(this._get_awsWin_marker(rwin), 1);
				if(!this._awsWins.length)
					this._myDoubles = [];
			}
			else
				this._myDoubles = [];
			this._is_awsWin = false;
		}
		
		
		let box = this._dock._box,
			actorBox = this._dock.actorBox;
		if(actorBox._WSareListed && !box._workspaces[box._workspaces.length-1]._windows.length) {//because the last ws wont be clear anymore
			actorBox.unlistWS();
			actorBox.listWS();
		}
	},
	remove_from_one_workspace: function(wsI) {//will only be used, when whole ws is destroyed or _reload()
		let newThis;
		
		if(this._is_awsWin) {
			newThis = this._myWindow[this._dock._WIN_VAR_KEY_icon];
			
			if(this != newThis) {//_window-array is used in window._destoy(), so if not the same, this is a double
				if(newThis) //not really sure why newThis can be undefined, but as far as I know now, it shouldnt hurt just to check for it
					newThis._myDoubles.splice(wsI, 1);//a ws is destroyed! splice should make sure, that indexes stay correct
				newThis = this;
			}
			else if(this._myDoubles.length > 1) { //there are other ws left (the last one is free space for itself - no push is used)
				this._myDoubles.splice(wsI, 1); //its leader now, no need to be in Doubles anymore
				
				//new double-leader:
				
				//get an existing double:
				wsI = this._myWindowClass._wsBox._workspaces.length;
				while(!this._myDoubles[--wsI]) {
					if(!wsI) {
						delete this._myWindow[this._dock._WIN_VAR_KEY_icon];
						break;
					}
				}
				
				if(wsI>0) {//FIXME: too tired to think straight. Thats sloppy....
					this._myDoubles[wsI]._myDoubles = this._myDoubles;
					this._myWindow[this._dock._WIN_VAR_KEY_icon] = this._myDoubles[wsI];
				}
			}
			else //all other ws have been cleaned
				delete this._myWindow[this._dock._WIN_VAR_KEY_icon];
			
		}
		else {
			newThis = this;
			delete this._myWindow[this._dock._WIN_VAR_KEY_icon];
		}
		
		if(this._dock._CONF_onlyOneIcon) {
			let wins = this._myAppWindows,
				i = wins.length,
				win;
			
			while(i--) {
				win = wins[i];
				if(win != this._myWindow && !win._is_awsWin)
					delete win[this._dock._WIN_VAR_KEY_icon];
			}
		}
		newThis._destroy(true);
	},
	
	request_total_destroy: function(win) {
		if(this._myDoubles.length && (!this._dock._CONF_onlyOneIcon || win.is_on_all_workspaces()))
			this.remove_from_all_workspaces(win);
		
		this.request_single_destroy(win);
		if(win.hasOwnProperty("justA_favWindow"))
			win._destroy();
		else {
			delete win[this._dock._WIN_VAR_KEY_icon];
			//this._myWindowClass.dec_shownWindows();
		}
	},
	request_single_destroy: function(win) {
		if(!win.hasOwnProperty("justA_favWindow"))
			this._myWindowClass.dec_shownWindows();
		
		if(!this._dock._CONF_onlyOneIcon) {
			this._destroy();
			return;
		}
			
		let wins = this._myAppWindows,
			i = wins.length;
		if(i<=1) {
			this._destroy();
			return;
		}
		
		while(i--) {
			if(wins[i] == win)//this has to be true once!
				break;
		}
		
		wins.splice(i, 1);
		
		if(win == this._myWindow)
			this._changeGroupLeader(wins[wins.length-1]); //wins was spliced, so length has changed
		else if(wins.length == 1)//length was at least 2, before splice
			this._label.text = this._myWindow.title;
		
		if(this == this._myWindowClass._wsBox._currentWindowFocus)
			this.actor.remove_style_pseudo_class("focused"); //no need for check for _check_for_awsWin -> removeFocus() isnt used
		
		if(this._dock._CONF_windowNumber) {
			let t = this._myAppWindows.length;
			if(this._myAppWindows[0].hasOwnProperty("justA_favWindow"))
				--t;
			
			if(t > 1)
				this._numLabel.text = t.toString();
			else if(this._numLabel) {
				this._numLabel.destroy();
				this._numLabel = false;
			}
		}
		
	},
	_destroy: function(noAnimation) {
		//using destroyLabel() would exclude it from animation:
		if(this._label)
			this._myWindow.disconnect(this._ID_titleChanged);
		
		
		if(this._myApp.get_windows().length) {
			let num = this._numLabel ? parseInt(this._numLabel.text) : 0,
				wins = this._myWindowClass._windows,
				i = wins.length,
				win, newNum;
			
			while(i--) {
				win = wins[i];
				if(win._myApp == this._myApp && win._numLabel && parseInt(win._numLabel.text) > num) {
					newNum = parseInt(win._numLabel.text)-1;
					if(newNum <= 1) {
						win._numLabel.destroy();
						win._numLabel = false;
					}
					else
						win._numLabel.text = newNum.toString();
				}
			}
		}
		
		if(!noAnimation) {//will be used, when box is destroyed or (in theory) a non-empty-ws disappears
			let wins = this._myWindowClass._windows;
			this._moveOthersLeft(wins, wins.length-1);
			//FIXME: we have an array-loop anyway. But can splice() be faster?
			//how (fast) is javascript dealing with array-movements?
			wins.pop(); //array has been reordered. So, last one has to be removed
			
			if(this._actor_state == STATE.INSERTED) {
				this._actor_state = STATE.GETS_REMOVED;
				Tweener.addTween(this.actor, {
					opacity: 0,
					time: 0.4,
					transition: "easeOutQuart",
					onComplete: function() {
						this.destroy();
					}
				});
			}
		}
		else {
			this._myWindowClass._windows.splice(this._myIndex, 1);
			this.actor.destroy();
		}
	}
};

function X_windowIconButon(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble) {
	windowIconButton.prototype._init.call(this,
			dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble);
}
X_windowIconButon.prototype = {
    __proto__: windowIconButton.prototype,
	
	_createIcon: function(iconSize, buttonWidth, newY) {
		//window.push() is happening outside because then _CONF_onlyOneIcon can be checked before creating this class
		newY = newY || this._dock._DATA_iconSpacingTop;
		
		let realIconSize = iconSize - ICON_PADDING_SUM,
			item = new St.Button({ style_class: "windowIconButton",
				reactive: true,
				can_focus: false,
				width: buttonWidth,
				height: iconSize,
				x: this._calcX(),
				y: newY,
				opacity: 0,
				x_fill: true,
				y_fill: false
			}),
			
			group = new St.BoxLayout(),
			icon = this._myApp.create_icon_texture(this._dock._DATA_iconTextureSize),
			dragable = DND.makeDraggable(item, {manualMode:true, restoreOnSuccess:true});
		
		item._delegate = this;
		dragable.connect("drag-begin", Lang.bind(this, this._startDrag));
		dragable.connect("drag-cancelled", Lang.bind(this, this._endDrag));
		dragable.connect("drag-end", Lang.bind(this, this._endDrag));
		item.connect("button-release-event", Lang.bind(this, this._onMouseClick));
		item.connect("button-press-event", Lang.bind(this, function(actor, event) {
				Tweener.removeTweens(this.actor);
				Tweener.removeTweens(this._icon);
				this._dragable._onButtonPress(actor, event);
			}));
		
		icon.set_size(realIconSize, realIconSize);
		group.add(icon);
		item.set_child(group);
		
		this.actor = item;
		this._icon = icon;
		this._group = group;
		this._dragable = dragable;
		
		if(this._dock._CONF_windowNumber)
			this._calcNumber();
			
		this._showWindowStats();
		
		if(this._dock._CONF_hoverIcons)
			this._ID_enterEvent = this.actor.connect("enter-event", Lang.bind(this, this._check_openList));
	},
	insertIcon: function(newY) {
		if(this._actor_state == STATE.REMOVED)
			this._dock.actor.add(this.actor);
		this._actor_state = STATE.INSERTED;
		
		this.change_x = this._tween_x;
		this.change_size = this._tween_size;
		Tweener.addTween(this.actor, {
			opacity: 255,
			y: newY || this._dock._DATA_iconSpacingTop,
			time: 0.3,
			transition: "easeInOutSine"
		});
	},
	removeIcon: function(movesUp, noAnimation) {
		if(this._actor_state != STATE.INSERTED)
			return;
		
		
		this.change_x = this._set_x;
		this.change_size = this._set_size;
		
		if(!noAnimation) {
			this._actor_state = STATE.GETS_REMOVED;
			Tweener.addTween(this.actor, {
					opacity: 0,
					y: this.actor.y + (movesUp ? -this.actor.height : this.actor.height),
					time: 0.5,
					transition: "easeOutQuart",
					onComplete: Lang.bind(this, function() {
							if(this._actor_state == STATE.GETS_REMOVED) {
								this._actor_state = STATE.REMOVED;
								this._dock.actor.remove_actor(this.actor);
							}
						})
				});
		}
		else {
			this._actor_state = STATE.REMOVED;
			this._dock.actor.remove_actor(this.actor);
		}
	},
	createLabel: function() {
		this._label = new St.Label({
				text: this._myWindow.title,
				style: this._dock._DATA_iconLabel_style
			});
		this._group.add_style_class_name("labled_background");
		this._ID_titleChanged = this._myWindow.connect("notify::title", Lang.bind(this, function() {this._label.text = this._myWindow.title;}));
	},
	setY: function(y) {
		if(this.actor)
			Tweener.addTween(this.actor, {
				y: y,
				time: this._dock._CONF_showTime,
				transition: "easeOutQuad"
			});
	},
	_set_x: function() {
		this.actor.set_x(this._calcX());//width is the same, but index has been changed
	},
	_tween_x: function() {
		Tweener.addTween(this.actor, {
				x: this._calcX(),
				time: 0.3,
				transition: "easeOutBack"
			});
	},
	_set_size: function(w, h, iconSize) {
		this.actor.set_x(this._calcX());
		this.actor.set_size(w, h);
		
		this._icon.set_size(iconSize, iconSize);
	},
	_tween_size: function(w, h, iconSize) {
		Tweener.addTween(this.actor, {
				x: this._calcX(),
				width: w,
				height: h,
				time: 0.3,
				transition: "easeInOutCubic",
			});
		Tweener.addTween(this._icon, {
				width: iconSize,
				height: iconSize,
				time: 0.3,
				transition: "easeInOutCubic",
			});
	},
	
	zoomTo: function(x, y, iconSize, buttonWidth, wideness, maxSize) {
		let calcX = this._calcX(),
			diff = Math.round((calcX - x) / wideness),
			posDiff;
		
		//posDiff = Math.max(Math.min(diff, maxSize), -maxSize) + ((-diff > maxSize) ? maxSize : ((-diff < -maxSize) ? -maxSize : 0)); // real fisheye
		//posDiff = Math.max(Math.min(diff, maxSize), -maxSize) + Math.max(Math.min(-diff/2, maxSize), -maxSize); //tweening fish-eye
		posDiff = Math.max(Math.min(diff, maxSize), -maxSize); //cheating fish-eye
		diff = Math.min(Math.abs(diff), maxSize);
		
		let add = maxSize - diff,
			newWidth_button = buttonWidth + add,
			newHeight_button = iconSize  + add,
			newSize_icon = newHeight_button - ICON_PADDING_SUM;
		
		/*this.actor.set_x(calcX + posDiff - Math.round(add/2));
		this.actor.set_size(newWidth_button, newHeight_button);
		this._icon.set_size(newSize_icon, newSize_icon);*/
		
		Tweener.addTween(this.actor, {
				x: calcX + posDiff - Math.round(add/2),
				y: y ? y-add : y,//Asuming: if given, y wont be 0 (bottom-padding)
				width: newWidth_button,
				height: newHeight_button,
				time: 0.4
			});
		Tweener.addTween(this._icon, {
				width: newSize_icon,
				height: newSize_icon,
				time: 0.4
			});
		
		/*if(y)//Asuming: if given, y wont be 0 (bottom-padding)
			this.actor.set_y(y-add);*/
	},
	undoZoom: function(iconSize, buttonWidth, y) {
		
		Tweener.addTween(this.actor, {
				x: this._calcX(),
				y: y,
				width: buttonWidth,
				height: iconSize,
				time: 0.5,
				transition: "easeInOutCubic",
			});
		
		let size = iconSize - ICON_PADDING_SUM;
		Tweener.addTween(this._icon, {
				width: size,
				height: size,
				time: 0.3,
				transition: "easeInOutCubic",
			});
	},
	
	openList: function() {
		let dock = this._dock,
			windowList = dock._windowList;
		
		dock._windowList_timeout = false;
		if(dock._windowList_current == this || dock._menu) //already created one or menu is opened
			return;
		
		cleanActor(windowList.actor);
		
		if(!this._myWindowClass.listAllWindows(windowList, this, PREVIEW_HOVER_HEIGHT))
			return;
		
		dock._windowList_current = this;
		
		let w = windowList.actor.width,
			x = Math.round(dock.actor.x + this.actor.x - w/2 + this.actor.width/2),
			y = ((dock._CONF_dockY_type == BOTTOM) ? dock.actor.y + this._myWindowClass._isListedTo - windowList.actor.height : dock.actor.y + this.actor.y + this._myWindowClass._iconSize),
			monitor = dock._getMonitor(),
			calcX = dock.actorBox._calcDockX(dock._dockRealWidth),
			minX = monitor.x,
			maxX = monitor.x + monitor.width;
		
		if(x < minX)
			x = minX;
		else if(x > maxX)
			x = maxX;
		
		windowList.actor.set_position(x, y);
		windowList.actor.show();
	}
}
function Y_windowIconButon(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble) {
	//this._init(dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble);
	windowIconButton.prototype._init.call(this,
			dock, app, window, windowClass, i, iconSize, buttonWidth, ypos, isDouble);
}
Y_windowIconButon.prototype = {
    __proto__: windowIconButton.prototype,
	
	_createIcon: function(iconSize, buttonWidth, newY) {
		//window.push() is happening outside because then _CONF_onlyOneIcon can be checked before creating this class
		newY = newY || this._dock._DATA_iconSpacingTop;
		
		let realIconSize = iconSize - ICON_PADDING_SUM,
			item = new St.Button({ style_class: "windowIconButton",
				reactive: true,
				can_focus: false,
				height: buttonWidth,
				width: iconSize,
				y: this._calcX(),
				x: newY,
				opacity: 0,
				y_fill: true,
				x_fill: false
			}),
			
			group = new St.BoxLayout({vertical:true}),
			icon = this._myApp.create_icon_texture(this._dock._DATA_iconTextureSize),
			dragable = DND.makeDraggable(item, {manualMode:true, restoreOnSuccess:true});
		
		item._delegate = this;
		dragable.connect("drag-begin", Lang.bind(this, this._startDrag));
		dragable.connect("drag-cancelled", Lang.bind(this, this._endDrag));
		dragable.connect("drag-end", Lang.bind(this, this._endDrag));
		item.connect("button-release-event", Lang.bind(this, this._onMouseClick));
		item.connect("button-press-event", Lang.bind(this, function(actor, event) {
				Tweener.removeTweens(this.actor);
				Tweener.removeTweens(this._icon);
				this._dragable._onButtonPress(actor, event);
				/*//this._dock.stopZooming();
				//this._dock.removeZoom();
				return;
				//this.actor.set_position(y, this._calcX());
				//this.actor.set_size(buttonWidth, iconSize);
				//let size = iconSize - ICON_PADDING_SUM;
				//this._icon.set_size(size, size);
				Mainloop.timeout_add(300, Lang.bind(this, function() {
					Tweener.removeTweens(this.actor);
					Tweener.removeTweens(this._icon);
					this._dragable._onButtonPress(actor, event);
				}));*/
			}));
		
		icon.set_size(realIconSize, realIconSize);
		group.add(icon);
		item.set_child(group);
		
		this.actor = item;
		this._icon = icon;
		this._group = group;
		this._dragable = dragable;
		
		if(this._dock._CONF_windowNumber)
			this._calcNumber();
			
		this._showWindowStats();
		
		if(this._dock._CONF_hoverIcons)
			this._ID_enterEvent = this.actor.connect("enter-event", Lang.bind(this, this._check_openList));
	},
	insertIcon: function(newY) {
		if(this._actor_state == STATE.REMOVED)
			this._dock.actor.add(this.actor);
		this._actor_state = STATE.INSERTED;
		
		this.change_x = this._tween_x;
		this.change_size = this._tween_size;
		Tweener.addTween(this.actor, {
			opacity: 255,
			x: newY || this._dock._DATA_iconSpacingTop,
			time: 0.3,
			transition: "easeInOutSine"
		});
	},
	removeIcon: function(movesUp, noAnimation) {
		if(this._actor_state != STATE.INSERTED)
			return;
		
		
		this.change_x = this._set_x;
		this.change_size = this._set_size;
		if(!noAnimation) {
			this._actor_state = STATE.GETS_REMOVED;
			Tweener.addTween(this.actor, {
					opacity: 0,
					x: this.actor.x + (movesUp ? -this.actor.width : this.actor.width),
					time: 0.5,
					transition: "easeOutQuart",
					onComplete: Lang.bind(this, function() {
							if(this._actor_state == STATE.GETS_REMOVED) {
								this._actor_state = STATE.REMOVED;
								this._dock.actor.remove_actor(this.actor);
							}
						})
				});
		}
		else {
			this._actor_state = STATE.REMOVED;
			this._dock.actor.remove_actor(this.actor);
		}
	},
	createLabel: function() {
		this._label = new St.Label({
				text: this._myWindow.title,
				style: this._dock._DATA_iconLabel_style
			});
			
		this._label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
		this._label.clutter_text.line_wrap = true;
		this._group.add_style_class_name("labled_background");
		this._ID_titleChanged = this._myWindow.connect("notify::title", Lang.bind(this, function() {this._label.text = this._myWindow.title;}));
	},
	setY: function(y) {
		if(this.actor)
			Tweener.addTween(this.actor, {
				x: y,
				time: this._dock._CONF_showTime,
				transition: "easeOutQuad"
			});
	},
	_set_x: function() {
		this.actor.set_y(this._calcX());//width is the same, but index has been changed
	},
	_tween_x: function() {
		Tweener.addTween(this.actor, {
				y: this._calcX(),
				time: 0.3,
				transition: "easeOutBack"
			});
	},
	_set_size: function(w, h, iconSize) {
		this.actor.set_y(this._calcX());
		this.actor.set_size(h, w);
		
		this._icon.set_size(iconSize, iconSize);
	},
	_tween_size: function(w, h, iconSize) {
		Tweener.addTween(this.actor, {
				y: this._calcX(),
				height: w,
				width: h,
				time: 0.3,
				transition: "easeInOutCubic",
			});
		Tweener.addTween(this._icon, {
				width: iconSize,
				height: iconSize,
				time: 0.3,
				transition: "easeInOutCubic",
			});
	},
	
	zoomTo: function(x, y, iconSize, buttonWidth, wideness, maxSize) {
		let calcX = this._calcX(),
			diff = Math.round((calcX - x) / wideness),
			posDiff;
		
		//posDiff = Math.max(Math.min(diff, maxSize), -maxSize) + ((-diff > maxSize) ? maxSize : ((-diff < -maxSize) ? -maxSize : 0)); // real fisheye
		//posDiff = Math.max(Math.min(diff, maxSize), -maxSize) + Math.max(Math.min(-diff/2, maxSize), -maxSize); //tweening fish-eye
		posDiff = Math.max(Math.min(diff, maxSize), -maxSize); //cheating fish-eye
		diff = Math.min(Math.abs(diff), maxSize);
		
		let add = maxSize - diff,
			newWidth_button = buttonWidth + add,
			newHeight_button = iconSize  + add,
			newSize_icon = newHeight_button - ICON_PADDING_SUM;
		
		//this.actor.set_y(calcX + posDiff - Math.round(add/2));
		//this.actor.set_size(newHeight_button, newWidth_button);
		//this._icon.set_size(newSize_icon, newSize_icon);
		
		Tweener.addTween(this.actor, {
				y: calcX + posDiff - Math.round(add/2),
				x: y ? y-add : y,//Asuming: if given, y wont be 0 (bottom-padding)
				width: newHeight_button,
				height: newWidth_button,
				time: 0.4
			});
		Tweener.addTween(this._icon, {
				width: newSize_icon,
				height: newSize_icon,
				time: 0.4
			});
		
		/*
		if(y)//Asuming: if given, y wont be 0 (bottom-padding)
			//this.actor.set_x(y-add);
		*/
	},
	undoZoom: function(iconSize, buttonWidth, y) {
		Tweener.addTween(this.actor, {
				y: this._calcX(),
				x: y,
				height: buttonWidth,
				width: iconSize,
				time: 0.3,
				transition: "easeInOutCubic",
			});
		
		let size = iconSize - ICON_PADDING_SUM;
		Tweener.addTween(this._icon, {
				width: size,
				height: size,
				time: 0.3,
				transition: "easeInOutCubic",
			});
	},
	
	openList: function() {
		let dock = this._dock,
			windowList = dock._windowList;
		
		dock._windowList_timeout = false;
		if(dock._windowList_current == this || dock._menu) //already created one or menu is opened
			return;
		
		cleanActor(windowList.actor);
		
		if(!this._myWindowClass.listAllWindows(windowList, this, PREVIEW_HOVER_HEIGHT))
			return;
			
		dock._windowList_current = this;
		
		let w = windowList.actor.height,
			x = Math.round(dock.actor.y + this.actor.y - w/2 + this.actor.height/2),
			y = ((dock._CONF_dockY_type == BOTTOM) ? dock.actor.x + GROUP_PADDING_BOTTOM - windowList.actor.width : dock.actor.x + this._myWindowClass._iconSize + GROUP_PADDING_BOTTOM),
			monitor = dock._getMonitor(),
			calcX = dock.actorBox._calcDockX(dock._dockRealWidth),
			minX = monitor.y,
			maxX = monitor.y + monitor.height;
		
		if(x < minX)
			x = minX;
		else if(x > maxX)
			x = maxX;
		windowList.actor.set_position(y, x);
		windowList.actor.show();
	}
}


function DockletMenu(dock) {
	this._init(dock);
}
DockletMenu.prototype = {
	__proto__: AppDisplay.AppIconMenu.prototype,
	
	_init: function(dock) {
		this._dock = dock;
		
		let side = (this._dock._CONF_dockY_type == BELOW_PANEL) ? 0 : this._dock._CONF_dockY_type;
		if(this._dock._CONF_dockY_type == BOTTOM)
			side = this._dock._CONF_rotated ? St.Side.RIGHT : St.Side.BOTTOM;
		else
			side = this._dock._CONF_rotated ? St.Side.LEFT : St.Side.TOP;
		PopupMenu.PopupMenu.prototype._init.call(this, dock.actor, St.Align.MIDDLE, side, 0);
		
		this.actor.add_style_class_name("panelDocklet_popup");
		
		dock.stopZooming(); //will just stop the Effect, not undo it
		Main.pushModal(this.actor);
		this._ID_clickedOutside = global.stage.connect('button-press-event', Lang.bind(this, function(actor, event) {
				if(!this.actor.contains(event.get_source())) {
					this._destroy();
				}
			}));
		
		
		
		this._ID_activate = this.connect("activate", Lang.bind(this, this._onActivate));
		
		LayoutManager.addChrome(this.actor);
		this.popup();
	},
	_redisplay: function() {
		let launchers = global.settings.get_strv(AppFavorites.getAppFavorites().FAVORITE_APPS_KEY),
			max = launchers.length,
			i=0, appsystem = Shell.AppSystem.get_default(),
			item, app;
		
		for(;i<max; ++i) {
			app = appsystem.lookup_app(launchers[i]);

			if(!app)
				continue;
				
			item = new PopupMenu.PopupMenuItem(app.get_name());
			item._app = app
			this.addMenuItem(item);
			
			item.addActor(app.create_icon_texture(24), {align: St.Align.END});
		}
		
		this._appendSeparator();
		
		this._settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
			this._settingsItem.addActor(new St.Bin({ style_class: "settings_button" }), {align: St.Align.END});
		this.addMenuItem(this._settingsItem);
		
	},
	_onActivate: function(actor, child) {
		if(child == this._settingsItem) {
			if(!this._dock._settingsMenu)
				this._dock._settingsMenu = new SettingsDialog(this._dock, this._dock._monitorId);
		}
		else if(child._app) {
			child._app.open_new_window(this._dock._box._currentWS);
		}
		this._destroy();
	},
	_destroy: function() {
		let dock = this._dock;
		
		Main.popModal(this.actor);
		if(this.isOpen)
			this.close(true);
		
		dock._menu = false;
		
		if(dock._CONF_autohide)
			dock.actorBox._hideDock();
		dock.removeZoom();
			
		global.stage.disconnect(this._ID_clickedOutside);
		this.disconnect(this._ID_activate);
		
		this.destroy();
	}
}

function IconMenu(source) {
	this._init(source);
}
IconMenu.prototype = {
	__proto__: AppDisplay.AppIconMenu.prototype,

	_init: function(source) {
		this._source = source;
		this._dock = source._dock;
		this._is_destroyed = false;
		
		
		let side = (this._dock._CONF_dockY_type == BELOW_PANEL) ? 0 : this._dock._CONF_dockY_type;
		if(this._dock._CONF_dockY_type == BOTTOM)
			side = this._dock._CONF_rotated ? St.Side.RIGHT : St.Side.BOTTOM;
		else
			side = this._dock._CONF_rotated ? St.Side.LEFT : St.Side.TOP;
		PopupMenu.PopupMenu.prototype._init.call(this, source.actor, St.Align.MIDDLE, side, 0);
		
		this.actor.add_style_class_name("panelDocklet_popup");
		
		this._dock.stopZooming(); //will just stop the Effect, not undo it
		this._dock.hideWindowList();

		this._ID_activate = this.connect("activate", Lang.bind(this, this._onActivate));

		this._ID_destroy = source.actor.connect("destroy", Lang.bind(this, this._destroy));
		
		this._ID_keyEscape = this.actor.connect('key-press-event', Lang.bind(this, function(actor, event) {
				if (event.get_key_symbol() == Clutter.Escape)
					this._destroy();
			}));
		
		this._ID_clickedOutside = global.stage.connect('button-press-event', Lang.bind(this, function(actor, event) {
				let source = event.get_source();
				if(!this.actor.contains(source)
						&& source != this._item_closeWin
						&& source != this._item_mapWin
						&& source != this._item_minimizeWin
						&& source != this._item_newWin
						&& source != this._item_settings
						&& source != this._item_moveUp
						&& source != this._item_moveDown
						&& source != this._item_toggleFav)
					this._destroy();
			}));
		LayoutManager.addChrome(this.actor);
		
		Main.pushModal(this.actor);
		this.popup();
	},
	_removeListener: function() {
		if(this._ID_clickedUp)
			this._item_moveUp.disconnect(this._ID_clickedUp);
		if(this._ID_clickedDown)
			this._item_moveDown.disconnect(this._ID_clickedDown);
		if(this._ID_clickedSettings)
			this._item_settings.disconnect(this._ID_clickedSettings);
		if(this._ID_clickedFavs)
			this._item_toggleFav.disconnect(this._ID_clickedFavs);
		if(this._ID_clickedMap)
			this._item_mapWin.disconnect(this._ID_clickedMap);
		if(this._ID_clickedMinimize)
			this._item_minimizeWin.disconnect(this._ID_clickedMinimize);
		if(this._ID_clickedClose)
			this._item_close.disconnect(this._ID_clickedClose);
		
		this.actor.disconnect(this._ID_keyEscape);
		global.stage.disconnect(this._ID_clickedOutside);
		this.disconnect(this._ID_activate);
		if(this._source.actor)
			this._source.actor.disconnect(this._ID_destroy);
	},
	_redisplay: function() {
		//Buttons with a set_tooltip_text() needs at least a label:""
		//who knows why...
		//Also set_tooltip_text is causing some strange warnings...
		
		let source = this._source,
			isBottom = source._dock._CONF_dockY_type == BOTTOM,
			section = new St.BoxLayout({vertical: false}),
			index = source._myIndex,
			sourceWin = this._source._myWindow,
			isFavWin = sourceWin.hasOwnProperty("justA_favWindow"),
			actionMenu;
		
		//windows
		if(isBottom && this._dock._CONF_showWindowList) {
			source._myWindowClass.listAllWindows(this, source, PREVIEW_RIGHT_CLICK_HEIGHT);
			this._appendSeparator();
		}
		
		//settings
		this._item_settings = new St.Button( {style_class: "action_button settings_button", label:""});
		//this._item_settings.set_tooltip_text(_("Box-settings"));
		section.add(this._item_settings);
		this._ID_clickedSettings = this._item_settings.connect("clicked", Lang.bind(this, this._onActivate));
		
		//favs
		if(AppFavorites.getAppFavorites().isFavorite(this._source._myApp.get_id())) {
			this._item_toggleFav = new St.Button({style_class: "action_button removeFav", label:""});
			//this._item_toggleFav.set_tooltip_text(_("Remove from Favorites"));
		}
		else {
			this._item_toggleFav = new St.Button({style_class: "action_button addFav", label:""});
			//this._item_toggleFav.set_tooltip_text(_("Add to Favorites"));
		}
		section.add(this._item_toggleFav);
		this._ID_clickedFavs = this._item_toggleFav.connect("clicked", Lang.bind(this, this._onActivate));
		
		//middle
		let label = new St.Label( {style_class: "labelLine"});
		section.add(label, { expand: true, x_fill: true, x_align: St.Align.MIDDLE });
		
		if(!isFavWin) {
			//left
			if(this._source._myWindow.get_monitor()) {
				this._item_moveLeft = new St.Button({style_class: "action_button left", label:""});
				//this._item_moveLeft.set_tooltip_text(_("To left screen"));
				section.add(this._item_moveLeft, {expand: false});
				this._ID_clickedLeft = this._item_moveLeft.connect("clicked", Lang.bind(this, this._onActivate));
			}
			
			//right
			if(this._source._myWindow.get_monitor() < LayoutManager.monitors.length-1) {
				this._item_moveRight = new St.Button({style_class: "action_button right", label:""});
				//this._item_moveRight.set_tooltip_text(_("To right screen"));
				section.add(this._item_moveRight, {expand: false});
				this._ID_clickedRight = this._item_moveRight.connect("clicked", Lang.bind(this, this._onActivate));
			}
			if(!sourceWin.is_on_all_workspaces()) {
				//up
				if(this._source._myWindowClass._myWorkspace.index()) {//index > 0
					this._item_moveUp = new St.Button({style_class: "action_button up", label:""});
					//this._item_moveUp.set_tooltip_text(_("To workspace above"));
					section.add(this._item_moveUp, {expand: false});
					this._ID_clickedUp = this._item_moveUp.connect("clicked", Lang.bind(this, this._onActivate));
				}
				//down
				this._item_moveDown = new St.Button({style_class: "action_button down", label:""});
				//this._item_moveDown.set_tooltip_text(_("To workspace below"));
				section.add(this._item_moveDown, {expand: false});
				this._ID_clickedDown = this._item_moveDown.connect("clicked", Lang.bind(this, this._onActivate));
			}
			
			//map/ minimized
			if(source._myWindow.minimized) {
				this._item_mapWin = new St.Button({style_class: "action_button", label:"\u2610"});
				//this._item_mapWin.set_tooltip_text(_("Restore"));
				this._ID_clickedMap = this._item_mapWin.connect("clicked", Lang.bind(this, this._onActivate));
				section.add(this._item_mapWin);
			}
			else {
				this._item_minimizeWin = new St.Button({style_class: "action_button", label:"_"});
				//this._item_minimizeWin.set_tooltip_text(_("Minimize"));
				this._ID_clickedMinimize = this._item_minimizeWin.connect("clicked", Lang.bind(this, this._onActivate));
				section.add(this._item_minimizeWin);
			}
			
			//close
			this._item_close = new St.Button({style_class: "action_button", label:"X"});
			//this._item_close.set_tooltip_text(_("Close Window"));
			section.add(this._item_close);
			this._ID_clickedClose = this._item_close.connect("clicked", Lang.bind(this, this._onActivate));
		}
		
		
		this.addActor(section);
		
		//new
		this._item_newWin = new PopupMenu.PopupMenuItem(_("New Window"), {style_class: "specialOne"});
		this.addMenuItem(this._item_newWin);
		
		//quit
		this._item_quitApp = new PopupMenu.PopupMenuItem(_("Quit Application"), {style_class: "specialOne"});
		this.addMenuItem(this._item_quitApp);
		
		//windows
		if(!isBottom && this._dock._CONF_showWindowList) {
			this._appendSeparator();
			source._myWindowClass.listAllWindows(this, source, PREVIEW_RIGHT_CLICK_HEIGHT);
		}
	},
	_onActivate: function (clicked_actor, activate_actor) {
		if(!activate_actor && clicked_actor == this)//cause subsections causing "activate" a secound time since I dont use the built-in popupMenuManager anymore...
			return;
		
		if(clicked_actor == this._item_moveUp && this._source._myWindowClass._myWorkspace.index()) {
			this._source._myWindow.change_workspace_by_index(
					this._source._myWindowClass._myWorkspace.index()-1,
					false, // don't create workspace
					global.get_current_time()
				);
		}
		else if(clicked_actor == this._item_moveDown) {
			this._source._myWindow.change_workspace_by_index(
					this._source._myWindowClass._myWorkspace.index()+1,
					false, // don't create workspace
					global.get_current_time()
				);
		}
		else if(clicked_actor == this._item_moveLeft) {
			let win = this._source._myWindow;
			let monitor = LayoutManager.monitors[this._source._myWindow.get_monitor()-1];
			this._source._myWindow.move_frame(true, monitor.x, monitor.y);
		}
		else if(clicked_actor == this._item_moveRight) {
			//let win = this._source._myWindow,
			let monitor = LayoutManager.monitors[this._source._myWindow.get_monitor()+1];
			//this._source._myWindow.move_frame(true, monitor.x, win.get_input_rect().y);
			this._source._myWindow.move_frame(true, monitor.x, monitor.y);
		}
		else if(clicked_actor == this._item_settings) {
			if(!this._dock._settingsMenu)
				this._dock._settingsMenu = new SettingsDialog(this._dock, this._dock._monitorId);
		}
		else if(clicked_actor == this._item_mapWin)
			this._source.doMap();
		else if(clicked_actor == this._item_close)
			this._source.doClose();
		else if(clicked_actor == this._item_minimizeWin)
			this._source.doMinimize();
		else if(clicked_actor == this._item_closeWin)
			this._source.doClose();
		else if (clicked_actor == this._item_toggleFav) {
			let favs = AppFavorites.getAppFavorites(),
				favId = this._source._myApp.get_id(),
				isFav = favs.isFavorite(favId);
			if (isFav)
				favs.removeFavorite(favId);
			else
				favs.addFavorite(favId);
		}
		
		else if(activate_actor) {
			if(activate_actor._myWindow) {
				let win = activate_actor._myWindow;
				if(win.has_focus())
					win.minimize();
				else {
					let ws = win.get_workspace();
					if(ws == null) //if window was closed while menu was open
						return
					else if(ws != global.screen.get_active_workspace())
						ws.activate(global.get_current_time());
					win.activate(global.get_current_time());
				}
			}
			else if (activate_actor == this._item_newWin)
				this._source.doNew();
			
			else if (activate_actor == this._item_quitApp)
				this._source.doQuit();
		}
		if(!this._is_destroyed)//can happen, when box was destroyed (reloaded). Bsp: fav-Update
			this._destroy();
	},
	_destroy: function(noHide) {
		let dock = this._dock;
		
		Main.popModal(this.actor);
		if(this.isOpen)
			this.close();
		
		dock._menu = false; //needs to be before hiding
		this._is_destroyed = true;
		
		if(dock._CONF_autohide && !noHide)
			dock.actorBox._hideDock();
		dock.removeZoom();
			
		this._removeListener();
		this.destroy();
	}
}

function SettingsDialog(dock, monitorId, showWelcome) {
	this._init(dock, monitorId, showWelcome);
}
SettingsDialog.prototype = {
	//ST.Entry are causing some strange "Fensterverwaltung-Warnung" after Dialog has closed and a popup is opened
	//no idea why or what they exactly mean.
	
	_init: function(dock, monitorId, showWelcome) {
		this._dock = dock;
		this._isPrimary = (monitorId=="primary");
		
		let monitor = dock._getMonitor(),
			padding = 10,
			boxWidth = Math.round(monitor.width/1.5),
			boxHeight = Math.round(monitor.height/1.5),
			naviWidth = 200,
			headerHeight = 20,
			descHeight = 50,
			
			mainBox = this.actor = new St.BoxLayout({style_class: "panelDocklet_dialog",
				vertical: true,
				x:Math.round((monitor.width - boxWidth)/2) + monitor.x,
				y:Math.round((monitor.height - boxHeight)/2) + monitor.y,
				width: boxWidth + padding*2,
				height: boxHeight + padding*2,
			}),
			navi = this._navi = new St.BoxLayout({style_class: "naviLine",
				vertical: true,
				x:padding,
				y:padding,
				width: naviWidth,
				height: boxHeight
			}),
			scrollBox = new St.ScrollView({style_class: "contentBox",
				x:naviWidth + padding,
				y:headerHeight + padding,
				width: boxWidth-naviWidth,
				height: boxHeight-headerHeight
			}),
			content = new St.BoxLayout({vertical: true}),
			closeButton = new St.Button({style_class: "dialog_button", label:"x", x: padding + boxWidth-50, y:padding});
			
		
		mainBox.add(navi);
		mainBox.add(scrollBox);
			scrollBox.add_actor(content);
				this._descline = new St.Label({style_class: "descLine"});
				this._descline.clutter_text.line_wrap = true;
				content.add(this._descline);
				
				let t = new PopupMenu.PopupMenuSection(content);
				this._group = new PopupMenu.PopupComboMenu(t);
				//t.addMenuItem(this._group);
				t.addActor(this._group.actor);
				content.add(t.actor);
		
		this._headline = new St.Label({style_class: "headerLine", x: naviWidth + padding, y: padding, width: boxWidth - naviWidth, height: headerHeight});
		mainBox.add(this._headline);
		
		closeButton.connect("button-release-event", Lang.bind(this, this.close));
		mainBox.add(closeButton);
		
		this._undoButton = new St.Button({ style_class: "dialog_button", x: padding + boxWidth - 160, y: padding, reactive: true, can_focus: true, label: _("Undo")});
		this._undoButton.connect("button-release-event", Lang.bind(this, this.undoChanges));
		mainBox.add(this._undoButton);
		this._undoButton.hide();
		
		
		Main.uiGroup.add_actor(mainBox);
		
		if(this._isPrimary) {
			this._isPrimaryLabel = new St.Label({style:"color:red;", text:_("Main-Box")});
			this._navi.add(this._isPrimaryLabel, {y_fill: false});
		}
		this._chapters = [];
		this._addChapter(_("Welcome Stranger!"), this._welcome, _("There are a lot of settings, which can help you to costumize this extention to your needs.\n\
Also, there are four preconfigurations you can use.\n\
The preconfigurations are just changing already existing settings. So, you don't actually need them. \
But they can help you save time.\n\
\n\
You can open this dialog again by clicking with the right Mouse-Button on the box and then click on the settings-Button\n\
\n\
\n\
Please feel free to contact me, if you find bug, have suggestions, critics or feedback.\n\
I am allways happy about input - what kind ever. :-)\n\
\n\
Jodli (pw3@gmx.at)"));
		this._addChapter(_("Preconfigurations"), this._preconfigurations,
		_("You can chose one of already existing preconfigurations. \n\
They are just altering already existing settings. So you don't have to use them."));
		this._addChapter(_("Overal"), this._global, "");
		this._addChapter(_("Box - overal"), this._docklet, "");
		this._addChapter(_("Box - placing"), this._docklet_pos, "");
		this._addChapter(_("Window-Icons - overal"), this._icons_overal, _("This settings regard the behavior and appearance of the window-icons."));
		this._addChapter(_("Window-Icons - filter"), this._icons_filter, _("You can change when a window-icon will (or will not) be created."));
		this._addChapter(_("Favorites"), this._favorites, _("Both settings are possible at the same time.\nIf you really need it. ;-)"));
		this._addChapter(_("Additional"), this._extras, _("Here, you can add additional buttons to the left of the box."));
		
		
		if(!showWelcome)
			this._setChapter(1);
		else {
			this._restoreDefault();
			this._setChapter(0);
		}
		Main.pushModal(this.actor);
		
		
		this._oldSettings = dock.settings._get_backup();
	},
	parseDouble: function(v) {
		return Math.round(v*1000)/1000;
	},
	undoChanges: function() {
		this._dock.settings._restore_backup(this._oldSettings);
		this._dock._reload();
		this.close();
		new SettingsDialog(this._dock, (this._isPrimary ? "primary" : null));
	},
	_restoreDefault: function() {
		let dockS = this._dock.settings,
			monitorW = this._dock._getMonitor().width,
			xLeft = 250,
			xRightFromMiddle = 80,
			width = (monitorW/2 - xRightFromMiddle)-xLeft,
			x = this.parseDouble(1/(monitorW / (xLeft+width))),
			w = Math.max(this.parseDouble(1/(monitorW / width)), 0.1);
		
		if(monitorW*w < 100)
			w = this.parseDouble(1/(monitorW / 100));
		
		dockS.restoreDefault(Extention_path);
		dockS.set_double("dock-x-percent", x, true);
		dockS.set_double("dock-width-percent", w, true);
		dockS.set_int("dont-hide-size", Main.panel.actor.height-2, true);
		dockS.save_data();
		this._dock._reload();
	},
	_addChapter: function(t, fu, desc) {
		let b = new St.Button({label: t});
		
		b.connect("button-release-event", Lang.bind(this, function(actor, event, c) {
				this._setChapter(c);
			}, this._chapters.length));
		
		this._navi.add(b, {x_fill: false, x_align: St.Align.START});
		
		this._chapters.push([b, t, desc, fu]);
	},
	_setChapter: function(i) {
		cleanActor(this._group.actor);
		let c = this._chapters[i];
		
		if(this._currentChapter)
			this._currentChapter.remove_style_pseudo_class("chosen");
		c[0].add_style_pseudo_class("chosen");
		this._headline.text = c[1];
		this._descline.text = c[2];
		this._currentChapter = c[0];
		c[3].call(this);
	},
	
	_createDesc: function(t) {
		let l = new St.Label({style_class: "descLine", text: t});
		this._content.add(l);
	},
	
	_createItemLabel: function(section, title, desc) {
		let labelGroup = new St.BoxLayout({vertical: true}),
			label = new St.Label({style_class: "item_title", text: title});
		
		labelGroup.add(label);
		if(desc) {
			label = new St.Label({style_class: "item_desc", text: desc});
			label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
			
			label.clutter_text.line_wrap = true;
			labelGroup.add(label);
		}
		section.add(labelGroup, {expand:true});
	},
	_createSeparator: function() {
		this._group.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
	},
	_createSwitch: function(switched, settingsUrl, title, desc, doIt) {
		let dock = this._dock, //cant cache the settings-array - on reload it will change
			section = new St.BoxLayout({vertical: false, style:"padding: 5px"}),
			button = new St.Button({reactive: true, can_focus: false}),
			switchObj = new PopupMenu.Switch(switched);
		
		this._createItemLabel(section, title, desc);
		button.set_child(switchObj.actor);
		section.add(button);
		this._group.addActor(section, {x_fill: true});
		
		button.connect("button-press-event",  Lang.bind(this, function() {
				switchObj.toggle();
				this._undoButton.show();
				if(doIt)
					doIt(switchObj.state);
				dock.settings.set_boolean(settingsUrl, switchObj.state);
			}));
		
		switchObj._mySection = section;
		
		return switchObj;
	},
	_createCombo: function(value, settingsUrl, items, title, desc, fu) {
		let dock = this._dock, //cant cache the settings-array - on reload it will change
			section = new St.BoxLayout({vertical: false, style:"padding: 5px"}),
			combo = new PopupMenu.PopupComboBoxMenuItem({style_class: "panelDocklet_combo"});
			
		this._createItemLabel(section, title, desc);
		section.add(combo.actor, {y_fill:false});
		this._group.addActor(section, {x_fill: true});
		
		items.forEach(function(o) {
				let item = new PopupMenu.PopupMenuItem(_(o[0]));
				combo.addMenuItem(item, o[1]);
			});
		combo.setActiveItem(value);
		combo.connect("active-item-changed", Lang.bind(this, fu || function(menuItem, id) {
				this._undoButton.show();
				dock.settings.set_enum(settingsUrl, id);
				if(fu)
					fu();
			}));	
	},
	_createText: function(value, settingsUrl, title, desc, checkIt, parseDouble) {
		let dock = this._dock, //cant cache the settings-array - on reload it will change
			section = new St.BoxLayout({vertical: false, style:"padding:5px"}),
			entry = new St.Entry({style_class: "myEntry", text: value.toString()}),
			undoButton = this._undoButton,
			setData =  function(o) { 
				let i = parseDouble ? parseDouble(o.get_text()) : parseInt(o.get_text());
				if(checkIt) {
					i = checkIt(i);
					o.set_text(i.toString());
				}
				
				undoButton.show();
				if(parseDouble)
					dock.settings.set_double(settingsUrl, i);
				else
					dock.settings.set_int(settingsUrl, i);
			};;

		this._createItemLabel(section, title, desc);
		section.add(entry, {expand: false, y_fill:false});
		this._group.addActor(section);
		
		
		entry.clutter_text.connect("key-press-event", Lang.bind(this, function(o, e) { 
				let symbol = e.get_key_symbol();
				if (symbol == Clutter.Return || symbol == Clutter.KP_Enter)
					setData(o);
			}));
		entry.clutter_text.connect("key-focus-out", Lang.bind(this, setData));
		
		return section;
	},
	_createSlider: function(value, settingsUrl, title, desc, checkIt) {
		let dock = this._dock, //cant cache the settings-array - on reload it will change
			section = new St.BoxLayout({vertical: false, style:"padding: 5px"}),
			slider = new PopupMenu.PopupSliderMenuItem(value),
			entry = new St.Entry({style_class: "myEntry", text: value.toString()}),
			undoButton = this._undoButton,
			takeString = function(v) {
					v = Math.round(v*100)/100;
					if(checkIt)
						v = checkIt(v);
					entry.set_text(v.toString());
					slider.setValue(v);
					
					undoButton.show();
					dock.settings.set_double(settingsUrl, v);
				};
		
		this._createItemLabel(section, title, desc);
		section.add(slider.actor);
		section.add(entry);
		this._group.addActor(section, {x_fill: true});
		
		slider.connect("drag-end",  Lang.bind(slider, function() {takeString(this._value);}));
		
		entry.clutter_text.connect("key-press-event", Lang.bind(this, function(o, e) { 
				let symbol = e.get_key_symbol();
				if (symbol == Clutter.Return || symbol == Clutter.KP_Enter)
					takeString(o.get_text());
			}));
		entry.clutter_text.connect("key-focus-out", Lang.bind(this, function(o) {takeString(o.get_text());}));
		
		return section;
	},
	_createPreconfiguration: function(styleName, title, fu) {
		let button = new St.Button({reactive: true, can_focus: false, style_class: "screenshot"}),
			section = new St.BoxLayout({vertical: true}),
			lable = new St.Label({style_class: "polkit-dialog-headline", text: title}),
			pic = new St.Bin({style_class: styleName});
		
		button.set_child(section);
		section.add(lable, {expand:true});
		section.add(pic);
		this._group.addActor(button);
		
		button.connect("button-press-event",  Lang.bind(this, fu));
	},
	
	_welcome: function() {
		this._createSwitch(this._dock._CONF_expandBox, "first-time",
			_("First time startup"));
	},
	_preconfigurations: function() {
		//panel-docklet
		this._createPreconfiguration("screen_panelDocklet", _("Panel-Docklet"), function() {
				let dockS = this._dock.settings,
					monitorW = this._dock._getMonitor().width,
					xLeft = 250,
					xRightFromMiddle = 80,
					width = (monitorW/2 - xRightFromMiddle)-xLeft,
					x = this.parseDouble(1/(monitorW / (xLeft+width))),
					w = this.parseDouble(1/(monitorW / width));
				
				dockS.set_boolean("autohide", true, true);
				dockS.set_int("hide-to-opacity", 150, true);
				dockS.set_int("dont-hide-size", Main.panel.actor.height-2, true);
				dockS.set_boolean("cut-view", false, true);
				
				dockS.set_boolean("show-workspace-number", true, true);
				dockS.set_boolean("show-workspace-navigator", false, true);
				dockS.set_boolean("show-desktop-button", true, true);
				
				dockS.set_boolean("favorites-as-windows", false, true);
				dockS.set_boolean("favorites-as-buttons", false, true);
				
				dockS.set_enum("fix-docklet-position-at", FIXED_RIGHT, true);
				dockS.set_boolean("expand-box", false, true);
				dockS.set_double("dock-width-percent", w, true);
				dockS.set_double("dock-x-percent", x, true);
				dockS.set_enum("dock-y", TOP, true);
				
				dockS.set_boolean("zoom-effect", false, true);
				dockS.set_boolean("only-one-icon", false, true);
				dockS.set_boolean("order-icons", false, true);
				dockS.set_boolean("list-all-workspaces", false, true);
				dockS.set_boolean("show-window-title", false, true);
				dockS.set_int("basic-icon-size", 25, true);
				
				dockS.save_data();
				this._undoButton.show();
				this._dock._reload();
			});
		this._createSeparator();
		
		//panel
		this._createPreconfiguration("screen_panel", _("Panel"), function() {
				let dockS = this._dock.settings,
					w = this._dock._DATA_monitorWidth;
				
				dockS.set_boolean("autohide", false, true);
				dockS.set_boolean("cut-view", true, true);
				dockS.set_int("strut-space", 0, true);
				
				dockS.set_boolean("show-workspace-number", false, true);
				dockS.set_boolean("show-workspace-navigator", true, true);
				dockS.set_boolean("show-desktop-button", true, true);
				
				dockS.set_boolean("favorites-as-windows", false, true);
				dockS.set_boolean("favorites-as-buttons", true, true);
				
				dockS.set_enum("fix-docklet-position-at", FIXED_MIDDLE, true);
				dockS.set_boolean("expand-box", false, true);
				dockS.set_double("dock-width-percent", 1, true);
				dockS.set_double("dock-x-percent", 0.5, true);
				dockS.set_enum("dock-y", BOTTOM, true);
				
				dockS.set_boolean("zoom-effect", false, true);
				dockS.set_boolean("only-one-icon", false, true);
				dockS.set_boolean("order-icons", true, true);
				dockS.set_boolean("list-all-workspaces", false, true);
				dockS.set_boolean("show-window-title", true, true);
				dockS.set_int("basic-button-width", w/5, true);
				dockS.set_int("basic-icon-size", 25, true);
				
				dockS.save_data();
				this._undoButton.show();
				this._dock._reload();
			});
		this._createSeparator();
		
		//big panel
		this._createPreconfiguration("screen_big_panel", _("Big Panel"), function() {
				let dockS = this._dock.settings,
					w = this._dock._DATA_monitorWidth;
				
				dockS.set_boolean("autohide", true, true);
				dockS.set_int("hide-to-opacity", 0, true);
				dockS.set_int("dont-hide-size", 0, true);
				dockS.set_boolean("cut-view", false, true);
				
				dockS.set_boolean("show-workspace-number", false, true);
				dockS.set_boolean("show-workspace-navigator", true, true);
				dockS.set_boolean("show-desktop-button", true, true);
				
				dockS.set_boolean("favorites-as-windows", false, true);
				dockS.set_boolean("favorites-as-buttons", false, true);
				
				dockS.set_enum("fix-docklet-position-at", FIXED_MIDDLE, true);
				dockS.set_boolean("expand-box", false, true);
				dockS.set_double("dock-width-percent", 1, true);
				dockS.set_double("dock-x-percent", 0.5, true);
				dockS.set_enum("dock-y", BELOW_PANEL, true);
				
				dockS.set_boolean("zoom-effect", false, true);
				dockS.set_boolean("only-one-icon", false, true);
				dockS.set_boolean("order-icons", true, true);
				dockS.set_boolean("list-all-workspaces", true, true);
				dockS.set_boolean("show-window-title", true, true);
				dockS.set_int("basic-button-width", w/5, true);
				dockS.set_int("basic-icon-size", 25, true);
				
				dockS.save_data();
				this._undoButton.show();
				this._dock._reload();
			});
		this._createSeparator();
		
		//docklet
		this._createPreconfiguration("screen_docklet", _("Docklet"), function() {
				let dockS = this._dock.settings,
					mH = this._dock._getMonitor().height,
					
					p = 1 / (mH / (mH-Main.panel.actor.height));
				
				dockS.set_boolean("autohide", true, true);
				dockS.set_int("hide-to-opacity", 255, true);
				dockS.set_int("dont-hide-size", 25, true);
				dockS.set_boolean("cut-view", true, true);
				dockS.set_int("strut-space", 10, true);
				
				dockS.set_boolean("show-workspace-number", false, true);
				dockS.set_boolean("show-workspace-navigator", false, true);
				dockS.set_boolean("show-desktop-button", false, true);
				
				dockS.set_boolean("favorites-as-windows", true, true);
				dockS.set_boolean("favorites-as-buttons", false, true);
				
				dockS.set_enum("fix-docklet-position-at", FIXED_MIDDLE, true);
				dockS.set_boolean("expand-box", true, true);
				dockS.set_double("dock-width-percent", 0.2, true);
				dockS.set_double("dock-x-percent", this.parseDouble(1-p/2), true);
				dockS.set_double("max-width-percent", this.parseDouble(p), true);
				dockS.set_enum("dock-y", LEFT, true);
				
				dockS.set_boolean("zoom-effect", true, true);
				dockS.set_boolean("only-one-icon", true, true);
				dockS.set_boolean("order-icons", false, true);
				dockS.set_boolean("list-all-workspaces", false, true);
				dockS.set_boolean("show-window-title", false, true);
				dockS.set_int("basic-icon-size", 40, true);
				
				dockS.save_data();
				this._undoButton.show();
				this._dock._reload();
			});
		this._createSeparator();
		
		let defaultItem = new PopupMenu.PopupMenuItem(_("Restore Defaults"));
		defaultItem.connect("activate", Lang.bind(this, function() {
				this._restoreDefault();
				this._dock.settings.set_boolean("first-time", false);
				this._undoButton.show();
				this._dock._reload();
			}));
		this._group.addMenuItem(defaultItem);
	},
	_extras: function() {
		let dock = this._dock;
		
		this._createCombo(dock._CONF_trayButton, "create-tray-button", [[_("Always"), ALWAYS], [_("Auto"), AUTO], [_("Never"), NEVER]],
				_("Create tray-button"),
				_("When the box is positioned at the bottom of the screen, the message-tray (and its \"blind-pixel-row\" at the bottom) can be annoying. So, the bottom-right hot-Corner can be replaced with a button. \"Auto\" only adds this button, when necessary."));
		
		this._createSwitch(dock._CONF_showDesktopButton, "show-desktop-button", _("Desktop-button"));
		
		
		this._createSwitch(dock._CONF_showWSNavigator, "show-workspace-navigator", _("Workspace-navigator"), false,
			Lang.bind(this, function(s) {
					if(s)
						this._Text_navigatorNumber.show();
					else
						this._Text_navigatorNumber.hide();
				}));
		this._Text_navigatorNumber = this._createText(dock._CONF_wsNavigator_num, "workspace-navigators-num", _("Number of buttons"), false,
			function(i) { return Math.max(i, 2); });	
		if(!dock._CONF_showWSNavigator)
			this._Text_navigatorNumber.hide();
		
		this._createSwitch(dock._CONF_showWSline, "show-workspace-number", _("Workspace-number"));
	},
	_icons_filter: function() {
		let dock = this._dock;
		
		this._createSwitch(dock._CONF_onlyScreenWindows, "only-screen-windows",
			_("Ignore other monitors"), _("Window-icons are only created for windows on this monitor."));
		
		this._createSwitch(dock._CONF_showAllWS, "list-all-workspaces",
				_("List all workspaces"), _("(if auto-hide is enabled: Other workspaces will only show on mouse-over)"));
		
		this._Switch_onlyOneIcons = this._createSwitch(dock._CONF_onlyOneIcon, "only-one-icon",
				_("Group icons"), _("Every application will have only one icon per workspace."), Lang.bind(this, function() {
					if(this._Switch_orderIcons.state) {
						this._Switch_orderIcons.setToggleState(false);
						this._dock.settings.set_boolean("order-icons", false);
					}
				}));
		this._Switch_orderIcons = this._createSwitch(dock._CONF_orderIcons, "order-icons",
				_("Order icons"), _("New window-icons will be placed next to an icon of the same application."), Lang.bind(this, function() {
					if(this._Switch_onlyOneIcons.state) {
						this._Switch_onlyOneIcons.setToggleState(false);
						this._dock.settings.set_boolean("only-one-icon", false);
					}
				}));
	},
	_icons_overal: function() {
		let dock = this._dock;
		
		this._createCombo(dock._CONF_middleClick, "middle-click-action", [[_("Minimize"), MINIMIZE_WINDOW], [_("New Window"), NEW_WINDOW], [_("Close Window"), CLOSE_WINDOW], [_("Quit Application"), QUIT_APP]],
				_("Icon-middle-click-action"), _("(\"Close Window\" closes always only the current window, also when \"Group icons\" is enabled)"));
		
		
		this._createSeparator();
		
		this._createSwitch(dock._CONF_windowNumber, "show-window-number",
				_("Window-number"),
				_("If \"Group icons\" is enabled: it indicates the number of application-windows.\nIf disabled: It indicates the window-index for its application."), Lang.bind(this, function(s) {
					if(s)
						this._Switch_smartWindowNumber._mySection.show();
					else
						this._Switch_smartWindowNumber._mySection.hide();
				}));
		this._Switch_smartWindowNumber = this._createSwitch(dock._CONF_smartWindowNumber, "smart-window-number",
				_("Smart window-number"),
				_("Number will only be shown, if greater than 1."));
		if(!dock._CONF_windowNumber)
			this._Switch_smartWindowNumber._mySection.hide();
		
		this._createSwitch(dock._CONF_showWindowTitle, "show-window-title",
				_("Window-title"), false, Lang.bind(this, function(s) {
					if(s)
						this._Text_buttonMaxWidth.show();
					else
						this._Text_buttonMaxWidth.hide();
				}));
				
		this._Text_buttonMaxWidth = this._createText(dock._CONF_buttonMaxWidth, "basic-button-width",
				(dock._CONF_rotated ? _("Maximun button-height") : _("Maximum button-width")));	
		if(!dock._CONF_showWindowTitle)
			this._Text_buttonMaxWidth.hide();
			
		this._createText(dock._CONF_iconSize, "basic-icon-size",
				(dock._CONF_rotated ? _("Button-width") : _("Button-height")), _("If \"Window-title\" is enabled, font-size depends on icon-height."), function(i) { return Math.max(i, 10); });
	},
	_favorites: function() {
		let dock = this._dock;
		
		this._createSwitch(dock._CONF_smallFavs, "favorites-as-buttons", _("Favorites as buttons"));
		
		this._createSwitch(dock._CONF_windowFavs, "favorites-as-windows", _("Favorites as window-icons"),
				_("Favorites will be added to the box and behave like window-icons"));
	},
	_global: function() {
		let dock = this._dock;
		
		this._createSwitch(mainPanelDocklet._CONF_onAllScreens, "on-all-screens",
			_("On all monitors"), _("Boxes are created on every screen and are managed seperatly"));
		this._createSeparator();
		
		this._createSwitch(dock._CONF_showWindowList, "show-window-list",
				_("Right-click window-list"), _("List all application-windows in right-click-menu"));
		
		this._createSwitch(dock._CONF_windowTexture, "show-window-texture",
				_("Window preview"), _("Show window preview in right-click-menu instead of just the window title (affects right-click-menu, icon-hover-menu and drag-over-menu)"));
		
		this._createSwitch(dock._CONF_hoverIcons, "hover-window-list",
				_("Window-list on hover"), false, Lang.bind(this, function(s) {
					if(s)
						this._Text_hoverTimeout.show();
					else
						this._Text_hoverTimeout.hide();
				}));
		this._Text_hoverTimeout = this._createText(dock._CONF_hoverTimeout, "hover-timeout",
				_("Hover-timeout"), false, function(i) { return Math.max(i, 0); });
		if(!dock._CONF_hoverIcons)
			this._Text_hoverTimeout.hide();
		
		this._createSwitch(dock._CONF_zoomEffect, "zoom-effect",
				_("Fisheye-effect"));
	},
	_docklet: function() {
		let dock = this._dock;
		
		this._createSwitch(dock._CONF_autohide, "autohide",
				_("Auto-hide"), _("if enabled: Wont hide, when desktop is shown."), Lang.bind(this, function(s) {
					if(s) {
						this._Text_hideToOpacity.show();
						this._Text_dontHideSize.show();
						this._Text_timeUntilHide.show();
						this._Text_hideTime.show();
						this._Text_timeUntilShow.show();
						this._Text_showTime.show();
					}
					else {
						this._Text_hideToOpacity.hide();
						this._Text_dontHideSize.hide();
						this._Text_timeUntilHide.hide();
						this._Text_hideTime.hide();
						this._Text_timeUntilShow.hide();
						this._Text_showTime.hide();
					}
				}));
		this._Text_dontHideSize = this._createText(dock._CONF_dontHideSize, "dont-hide-size",
				_("Always in view"),
				_("How much of the box should stay in the view, when the box is hidden (0 is almost outside the view, ")+dock._CONF_iconSize+_(" [icon-size] is no movement)."),
				Lang.bind(this, function(i) { return Math.min(Math.max(i, 0), dock._CONF_iconSize); }));
		this._Text_hideToOpacity = this._createText(dock._CONF_hideToOpacity, "hide-to-opacity",
				_("Hidden Transparency"), _("0 is invisible, 255 is fully visible."),
				function(i) { return Math.min(Math.max(i, 0), 255); });
		
		
		this._Text_showTime = this._createText(dock._CONF_showTime, "show-time",
				_("Show-time"), false, function(i) { return Math.max(i, 0); }, this.parseDouble);
		this._Text_hideTime = this._createText(dock._CONF_hideTime, "hide-time",
				_("Hide-time"), false, function(i) { return Math.max(i, 0); }, this.parseDouble);
				
		
		this._Text_timeUntilHide = this._createText(dock._CONF_hideTimeout, "time-until-hide",
				_("Hide-waiting-time"), _("The delay from when the box should start hiding after mouse-out."),
				function(i) { return Math.max(i, 0); });
		this._Text_timeUntilShow = this._createText(dock._CONF_showTimeout, "time-until-show",
				_("Show-waiting-time"), _("The delay from when the box should start showing after mouse-over."),
				function(i) { return Math.max(i, 0); });
				
		
		
		
		if(!dock._CONF_autohide) {
			this._Text_hideToOpacity.hide();
			this._Text_dontHideSize.hide();
			this._Text_timeUntilHide.hide();
			this._Text_hideTime.hide();
			this._Text_timeUntilShow.hide();
			this._Text_showTime.hide();
		}
		
		this._createSwitch(dock._CONF_cutStruts, "cut-view",
				_("Cut view-region"), _("Prevent the box from covering parts of the screen."), Lang.bind(this, function(s) {
					if(s)
						this._Text_strut_space.show();
					else
						this._Text_strut_space.hide();
				}));
		this._Text_strut_space = this._createText(dock._CONF_strutSpace, "strut-space",
				_("Cut more"), _("Space between box and view-region"));
		if(!dock._CONF_cutStruts)
			this._Text_strut_space.hide();
		
	},
	_docklet_pos: function() {
		let dock = this._dock,
			dockY = dock._CONF_dockY_type;
		
		if(dock._CONF_rotated)
			dockY += ROTATION_MARK;
		this._createCombo(dockY, "dock-y", [[_("Top"), TOP], [_("Below Panel"), BELOW_PANEL], [_("Bottom"), BOTTOM], [_("Left"), LEFT], [_("Right"), RIGHT]],
				_("Screen-position"));
		
		this._createCombo(dock._CONF_fixDockPositionAt, "fix-docklet-position-at", [[_("Start"), FIXED_LEFT], [_("Middle"), FIXED_MIDDLE], [_("End"), FIXED_RIGHT]],
				_("Fixed at"), false, function(menuItem, id) {
					if(id == FIXED_RIGHT && dock._CONF_dockX_percent < 0.1)
						dock.settings.set_double("dock-x-percent", 0.1);
					else if(id == FIXED_LEFT && dock._CONF_dockX_percent > 0.9)
						dock.settings.set_double("dock-x-percent", 0.9);
					
					dock.settings.set_enum("fix-docklet-position-at", id);
				});
		
		this._createSwitch(dock._CONF_expandBox, "expand-box",
				_("Box-size depends on number of icons"), _("If enabled, \"Box-size\" will be considered as min-width."),
				Lang.bind(this, function(v) {
						if(v)
							this._Slider_maxWidth.show();
						else
							this._Slider_maxWidth.hide();
					}));
		
		this._Slider_maxWidth = this._createSlider(dock._CONF_maxWidth_percent, "max-width-percent",
				_("Box-size") + " (max)", false, function(v) { return Math.min(Math.max(v, 0.1), 1); });
		if(!dock._CONF_expandBox)
			this._Slider_maxWidth.hide();
		
		this._createSlider(dock._CONF_dockWidth_percent, "dock-width-percent",
				_("Box-size"), false, function(v) { return Math.min(Math.max(v, 0.1), 1); });
		
		this._createSlider(dock._CONF_dockX_percent, "dock-x-percent",
				_("Position"), false, function(v) {
					if(dock._CONF_fixDockPositionAt == FIXED_RIGHT)
						return Math.min(Math.max(v, 0.1), 1);
					else if(dock._CONF_fixDockPositionAt == FIXED_LEFT)
						return Math.min(Math.max(v, 0), 0.9);
					else
						return v;
				});
	},
	
	close: function() {
		Main.popModal(this.actor);
		this.actor.destroy();
		this._dock._settingsMenu = false;
	},
}

function reloadAllDocklets(k,v) {
	removeSecondaryDocklets();
	
	mainPanelDocklet.settings.set_boolean("on-all-screens", v, true); //if it was changed on a secondary monitor
	mainPanelDocklet.settings.save_data();
	if((mainPanelDocklet._CONF_onAllScreens = v)) {//Variable is changed here
		addSecondaryDocklets();
		mainPanelDocklet._secondaryPanelDocklets = secondaryPanelDocklets;
	}
	mainPanelDocklet._reload();
}

function addSecondaryDocklets() {
	let primaryIndex = LayoutManager.primaryIndex,
		i = LayoutManager.monitors.length;
	
	while(i--) {
		if(i == primaryIndex)
			return;
		
		secondaryPanelDocklets[i] = new panelDocklet(i, false);
		secondaryPanelDocklets[i].settings.connect("on-all-screens", reloadAllDocklets); //this is not a real connect!
	}
	
	ID_monitorEvent = global.screen.connect("monitors-changed", Lang.bind(this, function() {
			removeSecondaryDocklets();
			if(mainPanelDocklet._CONF_onAllScreens)
				addSecondaryDocklets();
			mainPanelDocklet._secondaryPanelDocklets = secondaryPanelDocklets; //pointer-update
			
			mainPanelDocklet._reload();
		}));
}
function removeSecondaryDocklets() {
	secondaryPanelDocklets.forEach(function(o) {o._destroy()});
	secondaryPanelDocklets = [];
	
	if(ID_monitorEvent) {
		global.screen.disconnect(ID_monitorEvent);
		ID_monitorEvent = false;
	}
}

function init(metadata) {
	Gettext.textdomain("panel-docklet@quina.at");
	Gettext.bindtextdomain("panel-docklet@quina.at", Extention_path + "/locale");
}
function enable() {
	mainPanelDocklet = new panelDocklet("primary", secondaryPanelDocklets);
	if(mainPanelDocklet._CONF_onAllScreens)
		addSecondaryDocklets();
	
	
	mainPanelDocklet.settings.connect("on-all-screens", reloadAllDocklets); //this is not a real connect!
	
	
	if(mainPanelDocklet.settings.get_boolean("first-time"))
		Mainloop.timeout_add(2000, Lang.bind(this, function() {
				new SettingsDialog(mainPanelDocklet, "primary", true);
				mainPanelDocklet.settings.set_boolean("first-time", false);
			}));
}
function disable() {
	mainPanelDocklet._destroy();
	mainPanelDocklet = null;
	
	removeSecondaryDocklets();
}
