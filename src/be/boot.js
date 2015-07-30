#!/usr/bin/env iojs

'use strict';

// Starting point of the application.
// Holds the loaded settings.
// Controls the workers.

var reloadDirectories = [ 'engine', 'form', 'api' ];

exports.reload = function() {

  for (var i = 0; i < reloadDirectories.length; i++) {
    var directory = reloadDirectories[i];

    var dirListing = fs.readdirSync(__dirname + '/' + directory);

    for (var j = 0; j < dirListing.length; j++) {

      var module = require.resolve('./' + directory + '/' + dirListing[j]);
      delete require.cache[module];
    }
  }

  exports.loadSettings();

  require('./engine/templateHandler').loadTemplates();

  require('./archive').reload();

};

var cluster = require('cluster');
var db;
var fs = require('fs');
var logger = require('./logger');
var generator;

var MINIMUM_WORKER_UPTIME = 5000;
var forkTime = {};

var defaultFilesArray;
var defaultImages = [ 'thumb', 'audioThumb', 'defaultBanner', 'spoiler' ];

var defaultFilesRelation;

var archiveSettings;
var dbSettings;
var generalSettings;
var templateSettings;
var genericThumb;
var defaultBanner;
var genericAudioThumb;
var spoilerImage;
var fePath;
var tempDirectory;
var maxRequestSize;
var maxBannerSize;
var maxFileSize;
var maxFlagSize;

var args = process.argv;

var debug = args.indexOf('-d') > -1;
debug = debug || args.indexOf('--debug') > -1;

var torDebug = args.indexOf('-td') > -1;
torDebug = torDebug || args.indexOf('--tor-debug') > -1;

var noDaemon = args.indexOf('-nd') > -1;
noDaemon = noDaemon || args.indexOf('--no-daemon') > -1;

var setRole = args.indexOf('-sr') > -1;
setRole = setRole || args.indexOf('--set-role') > -1;

var createAccount = args.indexOf('-ca') > -1;
createAccount = createAccount || args.indexOf('--create-account') > -1;

var reload = args.indexOf('-r') > -1;
reload = reload || args.indexOf('--reload') > -1;

var reloadLogin = args.indexOf('-rl') > -1;
reloadLogin = reloadLogin || args.indexOf('--reload-login') > -1;

var reloadBanner = args.indexOf('-rb') > -1;
reloadBanner = reloadBanner || args.indexOf('--reload-banner') > -1;

var reloadFront = args.indexOf('-rf') > -1;
reloadFront = reloadFront || args.indexOf('--reload-front') > -1;

var reload404 = args.indexOf('-rn') > -1;
reload404 = reload404 || args.indexOf('--reload-notfound') > -1;

var reloadAudioThumb = args.indexOf('-ra') > -1;
reloadAudioThumb = reloadAudioThumb || args.indexOf('--reload-audio') > -1;

var reloadThumb = args.indexOf('-rt') > -1;
reloadThumb = reloadThumb || args.indexOf('--reload-thumb') > -1;

var reloadSpoiler = args.indexOf('-rs') > -1;
reloadSpoiler = reloadSpoiler || args.indexOf('--rebuild-spoiler') > -1;

var reloadMaintenance = args.indexOf('-rm') > -1;
reloadSpoiler = reloadSpoiler || args.indexOf('--rebuild-maintenance') > -1;

var informedLogin;
var informedPassword;
var informedRole;

if (createAccount || setRole) {
  var loginIndex = args.indexOf('-l');
  if (loginIndex === -1) {
    loginIndex = args.indexOf('--login');
  }

  var passwordIndex = args.indexOf('-p');
  if (passwordIndex === -1) {
    passwordIndex = args.indexOf('--password');
  }

  var roleIndex = args.indexOf('-gr');
  if (roleIndex === -1) {
    roleIndex = args.indexOf('--global-role');
  }

  roleIndex++;
  passwordIndex++;
  loginIndex++;

  if (passwordIndex && passwordIndex < args.length) {
    informedPassword = args[passwordIndex];
  }

  if (loginIndex && loginIndex < args.length) {
    informedLogin = args[loginIndex];
  }

  if (roleIndex && roleIndex < args.length) {
    informedRole = args[roleIndex];
  }

}

exports.genericThumb = function() {
  return genericThumb;
};

exports.genericAudioThumb = function() {
  return genericAudioThumb;
};

exports.spoilerImage = function() {
  return spoilerImage;
};

exports.defaultBanner = function() {
  return defaultBanner;
};

exports.debug = function() {
  return debug;
};

exports.torDebug = function() {
  return torDebug;
};

exports.getDbSettings = function() {

  return dbSettings;
};

exports.getArchiveSettings = function() {
  return archiveSettings;
};

exports.getGeneralSettings = function() {
  return generalSettings;
};

exports.getTemplateSettings = function() {
  return templateSettings;
};

exports.getFePath = function() {
  return fePath;
};

exports.tempDir = function() {

  return tempDirectory;

};

function setMaxSizes() {
  if (generalSettings.maxFileSizeMB) {
    maxFileSize = generalSettings.maxFileSizeMB * 1024 * 1024;
  } else {
    maxFileSize = Infinity;
  }

  maxRequestSize = (generalSettings.maxRequestSizeMB || 2) * 1024 * 1024;

  if (generalSettings.maxBannerSizeKB) {
    maxBannerSize = generalSettings.maxBannerSizeKB * 1024;
  } else if (generalSettings.maxFileSizeMB) {
    maxBannerSize = maxFileSize;
  } else {
    maxBannerSize = 200 * 1024;
  }

  maxFlagSize = (generalSettings.maxFlagSizeKB || 32) * 1024;

}

function checkImagesSet() {

  for (var i = 0; i < defaultImages.length; i++) {

    var image = defaultImages[i];

    if (!templateSettings[image]) {
      var error = 'Template image ' + image;
      error += ' not set on the template settings.';
      throw error;
    }

  }

}

function setDefaultImages() {

  var thumbExt = templateSettings.thumb.split('.');

  thumbExt = thumbExt[thumbExt.length - 1].toLowerCase();

  genericThumb = '/genericThumb' + '.' + thumbExt;

  var audioThumbExt = templateSettings.audioThumb.split('.');

  audioThumbExt = audioThumbExt[audioThumbExt.length - 1].toLowerCase();

  genericAudioThumb = '/audioGenericThumb' + '.' + audioThumbExt;

  var bannerExt = templateSettings.defaultBanner.split('.');

  bannerExt = bannerExt[bannerExt.length - 1].toLowerCase();

  defaultBanner = '/defaultBanner' + '.' + bannerExt;

  var spoilerExt = templateSettings.spoiler.split('.');

  spoilerExt = spoilerExt[spoilerExt.length - 1].toLowerCase();

  spoilerImage = '/spoiler' + '.' + spoilerExt;
}

function composeDefaultFiles() {
  defaultFilesArray = [ '/', '/404.html', genericThumb, '/login.html',
      defaultBanner, spoilerImage, '/maintenance.html', genericAudioThumb ];

  defaultFilesRelation = {
    '/' : {
      generatorFunction : 'frontPage',
      command : reloadFront
    },
    '/404.html' : {
      generatorFunction : 'notFound',
      command : reload404
    },
    '/login.html' : {
      generatorFunction : 'login',
      command : reloadLogin
    },
    '/maintenance.html' : {
      generatorFunction : 'maintenance',
      command : reloadMaintenance
    }
  };

  defaultFilesRelation[genericThumb] = {
    generatorFunction : 'thumb',
    command : reloadThumb
  };

  defaultFilesRelation[spoilerImage] = {
    generatorFunction : 'spoiler',
    command : reloadSpoiler
  };

  defaultFilesRelation[defaultBanner] = {
    generatorFunction : 'defaultBanner',
    command : reloadBanner
  };

  defaultFilesRelation[genericAudioThumb] = {
    generatorFunction : 'audioThumb',
    command : reloadAudioThumb
  };

}

function loadDatabasesSettings() {
  var dbSettingsPath = __dirname + '/settings/db.json';

  dbSettings = JSON.parse(fs.readFileSync(dbSettingsPath));

  try {
    var archivePath = __dirname + '/settings/archive.json';

    archiveSettings = JSON.parse(fs.readFileSync(archivePath));
  } catch (error) {

  }
}

exports.loadSettings = function() {

  loadDatabasesSettings();

  var generalSettingsPath = __dirname + '/settings/general.json';

  generalSettings = JSON.parse(fs.readFileSync(generalSettingsPath));

  generalSettings.address = generalSettings.address || '0.0.0.0';
  generalSettings.port = generalSettings.port || 80;

  fePath = generalSettings.fePath || __dirname + '/../fe';

  tempDirectory = generalSettings.tempDirectory || '/tmp';

  setMaxSizes();

  var templateSettingsPath = fePath + '/templateSettings.json';

  templateSettings = JSON.parse(fs.readFileSync(templateSettingsPath));

  checkImagesSet();

  setDefaultImages();

  composeDefaultFiles();

  require('./engine/langOps').init();

};

exports.latestPostCount = function() {

  return generalSettings.latestPostCount || 5;

};

exports.maxThreads = function() {

  return generalSettings.maxThreadCount || 50;

};

exports.captchaExpiration = function() {

  return generalSettings.captchaExpiration || 5;

};

exports.maxFiles = function() {

  return generalSettings.maxFiles || 3;

};

exports.maxRequestSize = function() {
  return maxRequestSize;
};

exports.maxFileSize = function() {
  return maxFileSize;
};

exports.maxFlagSize = function() {
  return maxFlagSize;
};

exports.maxBannerSize = function() {
  return maxBannerSize;
};

// after everything is all right, call this function to start the workers
function bootWorkers() {

  var genQueue = require('./generationQueue');

  if (noDaemon) {
    db.conn().close();
    return;
  }

  var workerLimit;

  var coreCount = require('os').cpus().length;

  if (debug && coreCount > 2) {
    workerLimit = 2;
  } else {
    workerLimit = coreCount;
  }

  for (var i = 0; i < workerLimit; i++) {
    cluster.fork();
  }

  cluster.on('fork', function(worker) {

    forkTime[worker.id] = new Date().getTime();

    worker.on('message', function receivedMessage(message) {
      genQueue.queue(message);
    });
  });

  cluster.on('exit', function(worker, code, signal) {
    console.log('Server worker ' + worker.id + ' crashed.');

    if (new Date().getTime() - forkTime[worker.id] < MINIMUM_WORKER_UPTIME) {
      console.log('Crash on boot, not restarting it.');
    } else {
      cluster.fork();
    }

    delete forkTime[worker.id];
  });
}

function regenerateAll() {

  generator.all(function regeneratedAll(error) {
    if (error) {

      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }

    } else {
      bootWorkers();
    }
  });

}

function iterateDefaultPages(foundFiles, index) {

  index = index || 0;

  if (index >= defaultFilesArray.length) {
    bootWorkers();
    return;

  }

  var fileToCheck = defaultFilesArray[index];

  var fileData = defaultFilesRelation[fileToCheck];

  if (foundFiles.indexOf(fileToCheck) === -1 || fileData.command) {
    generator[fileData.generatorFunction](function generated(error) {
      if (error) {
        if (generalSettings.verbose) {
          console.log(error);
        }

        if (debug) {
          throw error;
        }
      } else {
        iterateDefaultPages(foundFiles, index + 1);
      }
    });
  } else {
    iterateDefaultPages(foundFiles, index + 1);
  }

}

// we need to check if the default pages can be found
function checkForDefaultPages() {

  generator = require('./engine/generator');
  require('./engine/templateHandler').loadTemplates();

  if (reload) {
    regenerateAll();
    return;
  }

  var files = db.files();

  files.aggregate({
    $match : {
      filename : {
        $in : defaultFilesArray
      }
    }
  }, {
    $project : {
      filename : 1,
      _id : 0
    }
  }, {
    $group : {
      _id : 1,
      pages : {
        $push : '$filename'
      }
    }
  }, function gotFiles(error, files) {
    if (error) {
      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    } else if (files.length) {
      iterateDefaultPages(files[0].pages);
    } else {
      regenerateAll();
    }
  });

}

try {
  exports.loadSettings();
} catch (error) {
  if (generalSettings.verbose) {
    console.log(error);
  }

  if (debug) {
    throw error;
  }
  return;
}

db = require('./db');

var createAccountFunction = function() {
  require('./engine/accountOps').registerUser({
    login : informedLogin,
    password : informedPassword
  }, function createdUser(error) {

    if (error) {

      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }

      checkForDefaultPages();

    } else {
      console.log('Account ' + informedLogin + ' created.');

      checkForDefaultPages();
    }

  }, informedRole, true);

};

var setRoleFunction = function() {

  require('./engine/accountOps').setGlobalRole(null, {
    role : informedRole,
    login : informedLogin
  }, function setRole(error) {

    if (error) {

      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }

      checkForDefaultPages();

    } else {
      console.log('Set role ' + informedRole + ' for ' + informedLogin + '.');

      checkForDefaultPages();
    }

  }, true);

};

function initTorControl() {

  require('./engine/torOps').init(function initializedTorControl(error) {
    if (error) {
      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    } else {
      if (!noDaemon) {
        require('./scheduleHandler').start();
      }

      if (createAccount) {
        createAccountFunction();
      } else if (setRole) {
        setRoleFunction();
      } else {
        checkForDefaultPages();
      }
    }

  });

}

function checkDbVersions() {

  db.checkVersion(function checkedVersion(error) {

    if (error) {
      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    } else {
      initTorControl();
    }

  });

}

if (cluster.isMaster) {

  db.init(function bootedDb(error) {

    if (error) {
      if (generalSettings.verbose) {
        console.log(error);
      }

      if (debug) {
        throw error;
      }
    } else {

      checkDbVersions();

    }

  });

} else {

  require('./workerBoot').boot();
}
