const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
Cu.import("resource://tbsortfolders/modules/tbsortfolders-sort.jsm");
Cu.import("resource:///modules/MailUtils.js");
Cu.import("resource:///modules/iteratorUtils.jsm"); // for fixIterator
Cu.import("resource://gre/modules/Services.jsm");

var g_accounts = Object();

var tbsf_prefs=Services.prefs.getBranch("extensions.tbsortfolders@xulforum.org.");
var tbsf_data = {};
var current_account = null;

function setStringPref(p, v) {

  return tbsf_prefs.setStringPref(p, v);
}

/* Most of the functions below are for *folder* sorting */

function assert(v, s) {
  if (!v) {
    Services.console.logStringMessage("Assertion failure "+s);
    throw "Assertion failure";
  }
}

function dump_tree(node, prefix) {
  if (prefix === undefined) prefix = "";
  dump(prefix+node.tagName+"\n");
  for (let i = 0; i < node.children.length; i++)
    dump_tree(node.children[i], prefix+" ");
}

function item_key(ftv_item) {

  return ftv_item._folder.URI;
}

function item_label(ftv_item) {

  return ftv_item._folder.name;
}

let ftvItems = {};

function rebuild_tree(full, collapse) {

  //dump("rebuild_tree("+full+");\n");
  let dfs = 0;
  /* Cache these expensive calls. They're called for each comparison :( */
  let myFtvItem = function(ftvitem) {

    if (!ftvItems[ftvitem._folder.URI]) {
      ftvItems[ftvitem._folder.URI] = { _folder: ftvitem._folder, text: ftvitem._folder.name };
    }
    return ftvItems[ftvitem._folder.URI];
  }
  let sort_function;
  let replace_data = false;
  let sort_method = tbsf_data[current_account][0];

  if (sort_method == 0) {
      //dump("0\n");
      sort_function = (c1, c2) => tbsf_sort_functions[0](myFtvItem(c1), myFtvItem(c2));
  } else if (sort_method == 1) {
      //dump("1\n");
      sort_function = (c1, c2) => tbsf_sort_functions[1](myFtvItem(c1), myFtvItem(c2));
  } else if (sort_method == 2) {
      //dump("2\n");
      sort_function =
        (c1, c2) => tbsf_sort_functions[2](tbsf_data[current_account][1], myFtvItem(c1), myFtvItem(c2));
      replace_data = true;
  }
  let fresh_data = {};
  let my_sort = function(a_ftv_items, indent) {
    let ftv_items = Array();

    for (let i = 0; i < a_ftv_items.length; ++i)
      ftv_items.push(a_ftv_items[i]);
    ftv_items.sort(sort_function);


    for (let i = 0; i < ftv_items.length; ++i) {
      dfs++;

      fresh_data[item_key(ftv_items[i])] = dfs;

    }

    gListeDossiers.load(ftv_items);
  }

  if (null==gListeDossiers.dossiers){

    let account = g_accounts[current_account];

    gListeDossiers.initListeDossiers(account);
  }

  my_sort(gListeDossiers.dossiers, "");

  if (replace_data)
    tbsf_data[current_account][1] = fresh_data; //this "fresh" array allows us to get rid of old folder's keys

}

function on_load() {

  let json = tbsf_prefs.getStringPref("tbsf_data");

  try {
    tbsf_data = JSON.parse(json);
  } catch (e) {
  }

  let account_manager = Cc["@mozilla.org/messenger/account-manager;1"].getService(Ci.nsIMsgAccountManager);
  let name;
  let accounts_menu = document.getElementById("accounts_menu");
  let accounts = [];
  for (let x of fixIterator(account_manager.accounts, Ci.nsIMsgAccount))
    accounts.push(x);
  if (!accounts.length) {
    document.querySelector("tabbox").style.display = "none";
    document.getElementById("err_no_accounts").style.display = "";
    return;
  }
  for (let account of accounts) {
    //dump(Object.keys(account)+"\n");
    //fill the menulist with the right elements
    if (!account.incomingServer)
      continue;
    //dump(account.incomingServer.rootFolder.name+"\n");
    name = account.incomingServer.rootFolder.name;
    let it = document.createElement("menuitem");
    it.setAttribute("label", name);
    accounts_menu.appendChild(it);

    //register the account for future use, create the right data structure in
    //the data
    g_accounts[name] = account;
    if (!tbsf_data[name]) tbsf_data[name] = Array();
  }

  document.getElementById("accounts_menu").parentNode.setAttribute("label", name);

  on_account_changed();

  accounts_on_load();
  extra_on_load();
}

function renumber(folder, start) {

  tbsf_data[current_account][1][folder.URI] = start++;

  let children = folder.children;

  if (folder.hasSubFolders){
    var subFolders=folder.subFolders;
    while (subFolders.hasMoreElements()) {
      var suivant=subFolders.getNext().QueryInterface(Components.interfaces.nsIMsgFolder);
      start = renumber(suivant, start);
    }
  }

  return start;
}

function move_up(folder) {

  let uri = folder.URI;
  let index=gFolderTreeView.getIndexOfFolder(folder);
  if (0 < index) {
    let previous_item = gFolderTreeView.getFolderForIndex(index-1);
    let previous_uri = previous_item.URI;
    let data = tbsf_data[current_account][1];
    renumber(previous_item, renumber(folder, data[previous_uri]));
    rebuild_tree();
  } else {
    //dump("This is unexpected\n");
  }
}

function on_move_up() {

  let tree = document.getElementById("foldersTree");
  let i = tree.view.selection.currentIndex;
  if (i < 0)
    return;
  let folder = gFolderTreeView.getFolderForIndex(i);

  if (0 < i) {
    move_up(folder);
    tree.view.selection.select(gFolderTreeView.getIndexOfFolder(folder));
  }
}

function on_move_down() {

  let tree = document.getElementById("foldersTree");
  let i = tree.view.selection.currentIndex;
  if (i < 0)
    return;
  let folder = gFolderTreeView.getFolderForIndex(i);
  let nb=gListeDossiers.dossiers.length;
  if (nb > i+1) {
    let next=gFolderTreeView.getFolderForIndex(i+1);
    move_up(next);
    tree.view.selection.select(gFolderTreeView.getIndexOfFolder(folder));
  }
}

function get_sort_method_for_account(account) {
  if (tbsf_data[account] && tbsf_data[account][0] !== undefined)
    return tbsf_data[account][0];
  else
    return 0;
}

function update_tree() {

  gListeDossiers.dossiers=null;
}

function on_account_changed() {
  //update the UI
  let new_account = document.getElementById("accounts_menu").parentNode.getAttribute("label");
  if (new_account != current_account) {
    current_account = new_account;
    let sort_method = get_sort_method_for_account(current_account);
    document.getElementById("sort_method").value = sort_method;
    update_tree();
    on_sort_method_changed();
  }
}

function on_sort_method_changed() {
  let sort_method = document.getElementById("sort_method").getAttribute("value");
  tbsf_data[current_account][0] = sort_method;
  if (sort_method == 2) {
    document.getElementById("default_sort_box").style.display = "none";
    document.getElementById("alphabetical_sort_box").style.display = "none";
    document.getElementById("manual_sort_box").style.display = "";
    if (!tbsf_data[current_account][1])
      tbsf_data[current_account][1] = {};
  } else if (sort_method == 1) {
    document.getElementById("default_sort_box").style.display = "none";
    document.getElementById("alphabetical_sort_box").style.display = "";
    document.getElementById("manual_sort_box").style.display = "none";
  } else if (sort_method == 0) {
    document.getElementById("default_sort_box").style.display = "";
    document.getElementById("alphabetical_sort_box").style.display = "none";
    document.getElementById("manual_sort_box").style.display = "none";
  }
  setStringPref("tbsf_data", JSON.stringify(tbsf_data));
  rebuild_tree(true, true);
}

function on_close() {
  on_refresh();
  window.close();
}

function on_refresh() {
  setStringPref("tbsf_data", JSON.stringify(tbsf_data));
  //it's a getter/setter so that actually does sth
  let mainWindow = Cc['@mozilla.org/appshell/window-mediator;1']
    .getService(Ci.nsIWindowMediator)
    .getMostRecentWindow("mail:3pane");
  mainWindow.gFolderTreeView.mode = mainWindow.gFolderTreeView.mode;
}

window.addEventListener("unload", on_refresh, false);


/* The functions below are for *account* sorting */

var g_other_accounts = null;

function accounts_on_load() {

  let accounts = Services.prefs.getCharPref("mail.accountmanager.accounts").split(",");
  /*let defaultaccount = Services.prefs.getCharPref("mail.accountmanager.defaultaccount");
  accounts = accounts.filter((x) => x != defaultaccount);
  accounts = [defaultaccount].concat(accounts);*/
  let servers = accounts.map(function (a) { return Services.prefs.getCharPref("mail.account."+a+".server");});
  let types = servers.map(function (s) { return Services.prefs.getCharPref("mail.server."+s+".type");});
  let names = servers.map(function (s) {
    try {
      return Services.prefs.getStringPref("mail.server."+s+".name");
    } catch (e) {
      return Services.prefs.getCharPref("mail.server."+s+".hostname");
    } });
  // mantis 4333
  let hiddensrv=servers.map(function (s) {
    try {
      return Services.prefs.getBoolPref("mail.server."+s+".hidden");
    } catch (e) {
      return false;
    } });
  // fin mantis 4333

  let mail_accounts = [];
  let news_accounts = [];
  let other_accounts = [];
  let add_li = function (list, [account, server, type, name]) {
    let li = document.createElement("listitem");
    li.setAttribute("label", name);
    li.value = account;
    list.appendChild(li);
  };
  let news_account_found = false;
  for (let i = 0; i < accounts.length; ++i) {
    switch (types[i]) {
      case "imap":
      case "pop3":
      case "movemail":
      case "rss":
      case "none":
        // mantis 4333
        if (hiddensrv[i])
          break;
        // fin mantis 4333
        mail_accounts.unshift([accounts[i], servers[i], types[i], names[i]]);
        add_li(document.getElementById("accounts_list"), mail_accounts[0]);
        document.getElementById("default_account").firstChild.setAttribute("disabled", false);
        /* We're not setting the "first account in the list" value in the UI
         * because it defaults to "first rss or mail account in the list */
        break;
      case "nntp":
        news_account_found = true;
        news_accounts.unshift([accounts[i], servers[i], types[i], names[i]]);
        let mi = document.createElement("menuitem");
        mi.setAttribute("value", accounts[i]);
        mi.setAttribute("label", names[i]);
        document.getElementById("default_account").appendChild(mi);
        add_li(document.getElementById("news_accounts_list"), news_accounts[0]);
        /* Set the "first account in the list value in the UI */
        if (defaultaccount == accounts[i])
          mi.parentNode.parentNode.value = accounts[i];
        break;
      default:
        let hidden = false;
        try {
          let hidden_pref = Services.prefs.getBoolPref("mail.server."+servers[i]+".hidden");
          hidden = hidden_pref;
        } catch (e) {
        }
        if (!hidden) {
          let mi = document.createElement("menuitem");
          mi.setAttribute("value", accounts[i]);
          mi.setAttribute("label", names[i]);
          document.getElementById("default_account").appendChild(mi);
          /* Set the "first account in the list" value in the UI */
          if (defaultaccount == accounts[i])
            mi.parentNode.parentNode.value = accounts[i];
        }
        other_accounts.unshift([accounts[i], servers[i], types[i], names[i]]);
    }
  }
  g_other_accounts = other_accounts;
  if (news_account_found) {
    document.getElementById("news_accounts_list").style.display = "";
  }
}

function update_accounts_prefs() {
  let accounts = document.getElementById("accounts_list");
  let new_pref = null;
  let first_mail_account = null;
  for (let i = 0; i < accounts.children.length; ++i) {
    let child = accounts.children[i];
    if (!first_mail_account)
      first_mail_account = child.value;
    new_pref = new_pref ? (new_pref + "," + child.value) : child.value;
  }
  for (let i = 0; i < g_other_accounts.length; ++i) {
    let [account, server, type, name] = g_other_accounts[i];
    new_pref = new_pref ? (new_pref + "," + account) : account;
  }
  let news_accounts = document.getElementById("news_accounts_list");
  for (let i = 0; i < news_accounts.children.length; ++i) {
    let child = news_accounts.children[i];
    new_pref = new_pref ? (new_pref + "," + child.value) : child.value;
  }

  let pref = Services.prefs.getCharPref("mail.accountmanager.accounts");
  pref.value = new_pref;
  
  Services.prefs.setCharPref("mail.accountmanager.accounts", new_pref);

  let default_account = document.getElementById("default_account").parentNode.value;
  if (default_account == "-1")
    Services.prefs.setCharPref("mail.accountmanager.defaultaccount") = first_mail_account;
  else
    Services.prefs.setCharPref("mail.accountmanager.defaultaccount") = default_account;
}

function account_move_up(index, listbox) {
  let item = listbox.getItemAtIndex(index);
  if (!item)
    return false;

  let previous_item = item.previousSibling;
  if (!previous_item)
    return false;

  let parent = item.parentNode;
  parent.insertBefore(parent.removeChild(item), previous_item);

  return true;
}

var g_active_list = null;

function on_account_move_up() {
  if (!g_active_list) return;

  let listbox = g_active_list;
  let i = listbox.selectedIndex;
  if (i < 0) return;
  if (account_move_up(i, listbox))
    listbox.selectedIndex = i-1;
  update_accounts_prefs();
}

function on_account_move_down() {
  if (!g_active_list) return;

  let listbox = g_active_list;
  let i = listbox.selectedIndex;
  if (i < 0) return;
  if (account_move_up(i+1, listbox))
    listbox.selectedIndex = i+1;
  update_accounts_prefs();
}

function on_account_restart() {
  let mainWindow = Cc['@mozilla.org/appshell/window-mediator;1']
    .getService(Ci.nsIWindowMediator)
    .getMostRecentWindow("mail:3pane");
  Services.startup.quit(Services.startup.eForceQuit | Services.startup.eRestart);
  window.close();
}

function on_accounts_list_click() {
  g_active_list = document.getElementById("accounts_list");
  document.getElementById("news_accounts_list").clearSelection();
}

function on_news_accounts_list_click() {
  g_active_list = document.getElementById("news_accounts_list");
  document.getElementById("accounts_list").clearSelection();
}

/* These are UI functions for the "Extra settings" tab */

/* Borrowed from http://mxr.mozilla.org/comm-central/source/mailnews/base/prefs/content/am-copies.js */
function on_pick_folder(aEvent) {
  let folder = aEvent.target._folder;
  let picker = document.getElementById("startupFolder");
  picker.folder = folder;
  picker.setAttribute("label", folder.prettyName);
  setStringPref("startup_folder", folder.URI);
}

function extra_on_load() {

  let startup_folder = tbsf_prefs.getStringPref("startup_folder");
  let picker = document.getElementById("startupFolder");
  let folder;
  if (startup_folder)
    folder = MailUtils.getFolderForURI(startup_folder);
  if (folder) {
    picker.folder = folder;
    picker.setAttribute("label", folder.prettyName);    
  } else {
    let menu = document.getElementById("startup_folder_method");
    menu.value = "0";
    picker.disabled = true;
  }
}

function on_startup_folder_method_changed(event) {
  let menu = event.target;
  let picker = document.getElementById("startupFolder");
  if (menu.value == "1") {
    picker.disabled = false;
    if (picker.folder)
      setStringPref("startup_folder", picker.folder.URI);
  } else {
    picker.disabled = true;
    setStringPref("startup_folder", "");
  }
}



var gListeDossiers={

  _treeElement: null,

  generateMap: function(ftv) {

    return this.dossiers;
  },

  //liste des dossiers du serveur
  dossiers: null,

  load: function(ftv_items) {

    this.dossiers=ftv_items;

    gFolderTreeView._rebuild();
  },

  initListeDossiers: function(compte) {

    this.dossiers=[];
    let serveur=compte.incomingServer;

    let racine=new ftvItem(serveur.rootFolder);
    for (let f of racine.children){
      this.dossiers.push(f);
    }

    this._treeElement=document.getElementById("foldersTree");

    gFolderTreeView.registerFolderTreeMode(this._treeElement.getAttribute("mode"),
                                           this,
                                           "Liste des dossiers");

    gFolderTreeView.load(this._treeElement);
  }
}
