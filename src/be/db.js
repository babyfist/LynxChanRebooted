'use strict';

var dbVersion = 2;

// takes care of the database.
// initializes and provides pointers to collections or the connection pool

var archive = require('./archive');
var mongo = require('mongodb');
var ObjectID = mongo.ObjectID;
var boot = require('./boot');
var settings = boot.getGeneralSettings();
var verbose = settings.verbose;
var debug = boot.debug();
var initArchive = settings.serveArchive || settings.archiveLevel;

var indexesSet;

var cachedDb;

var maxIndexesSet = 13;

var cachedFlood;
var cachedVersions;
var cachedPosts;
var cachedReports;
var cachedThreads;
var cachedBoards;
var cachedBans;
var cachedUsers;
var cachedCaptchas;
var cachedFiles;
var cachedTripcodes;
var cachedLog;
var cachedRecoveryRequests;
var cachedStats;
var cachedHashBans;
var cachedTorIps;
var cachedFlags;

var loading;

// start of version check
function registerLatestVersion(callback) {

  if (verbose) {
    console.log('Checking if latest version is ' + dbVersion);
  }

  cachedVersions.count({
    version : dbVersion,
    active : true
  }, function gotVersion(error, count) {
    if (error) {
      callback(error);
    } else if (count) {
      callback();
    } else {

      // style exception, too simple
      if (verbose) {
        console.log('Registering current version as ' + dbVersion);
      }

      cachedVersions.insert({
        version : dbVersion,
        deploy : new Date(),
        active : true,
        upgraded : false
      }, function addedVersion(error) {
        callback(error);

      });

      // style exception, too simple

    }
  });
}

// Implement upgrades here. The version is the current version.
function setPostingPreAggregatedFileMime(posting, collection, callback) {

  var files = [];

  for (var i = 0; i < posting.files.length; i++) {
    files.push(posting.files[i].path);
  }

  cachedFiles.find({
    filename : {
      $in : files
    }
  }, {
    filename : 1,
    contentType : 1
  }).toArray(function(error, foundFiles) {
    if (error) {
      callback(error);
    } else {

      var fileRelation = {};

      for (i = 0; i < foundFiles.length; i++) {
        var file = foundFiles[i];

        fileRelation[file.filename] = file.contentType;
      }

      for (i = 0; i < posting.files.length; i++) {
        posting.files[i].mime = fileRelation[posting.files[i].path];
      }

      collection.updateOne({
        _id : new ObjectID(posting._id)
      }, {
        $set : {
          files : posting.files
        }
      }, callback);

    }
  });

}

function setPostsPreAggreGatedFileMime(callback, cursor) {
  if (!cursor) {
    cursor = cachedPosts.find({
      'files.0' : {
        $exists : true
      }
    }, {
      files : 1
    });

  }

  cursor.next(function(error, post) {
    if (error) {
      callback(error);
    } else if (!post) {
      callback();
    } else {

      // style exception, too simple
      setPostingPreAggregatedFileMime(post, cachedPosts, function updatedMimes(
          error) {
        if (error) {
          callback(error);
        } else {
          setPostsPreAggreGatedFileMime(callback, cursor);
        }
      });
      // style exception, too simple

    }
  });
}

function setThreadsPreAggregatedFileMime(callback, cursor) {

  if (!cursor) {
    cursor = cachedThreads.find({
      'files.0' : {
        $exists : true
      }
    }, {
      files : 1
    });

  }

  cursor.next(function(error, thread) {
    if (error) {
      callback(error);
    } else if (!thread) {
      setPostsPreAggreGatedFileMime(callback);
    } else {

      // style exception, too simple
      setPostingPreAggregatedFileMime(thread, cachedThreads,
          function updatedMimes(error) {
            if (error) {
              callback(error);
            } else {
              setThreadsPreAggregatedFileMime(callback, cursor);
            }
          });
      // style exception, too simple

    }
  });

}

function upgrade(version, callback) {

  switch (version) {
  case 1:
    setThreadsPreAggregatedFileMime(callback);
    break;

  default:
    callback('Cannot upgrade from version ' + version);
  }

}

function iterateUpgrades(currentVersion, callback) {

  if (verbose) {
    console.log('Iterating db version ' + currentVersion);
  }

  if (currentVersion === dbVersion) {
    registerLatestVersion(callback);
    return;
  }

  upgrade(currentVersion, function upgraded(error) {
    if (error) {
      callback(error);
    } else {

      // style exception, too simple

      cachedVersions.updateOne({
        version : currentVersion
      }, {
        $set : {
          version : currentVersion,
          active : false,
          upgraded : true
        }
      }, {
        upsert : true
      }, function confirmedUpgrade(error) {
        if (error) {
          callback(error);
        } else {
          iterateUpgrades(currentVersion + 1, callback);
        }
      });

      // style exception, too simple

    }
  });

}

exports.checkVersion = function(callback) {

  cachedVersions = cachedDb.collection('witnessedReleases');

  cachedVersions.findOne({
    version : {
      $lt : dbVersion
    },
    upgraded : false
  }, {
    sort : {
      version : -1
    }
  }, function gotLatestVersion(error, version) {
    if (error) {
      callback(error);
    } else if (!version) {
      registerLatestVersion(callback);
    } else {
      iterateUpgrades(version.version, callback);
    }

  });

};
// end of version check

function indexSet(callback) {

  indexesSet++;

  if (indexesSet === maxIndexesSet) {
    loading = false;

    if (initArchive) {
      archive.init(callback);
    } else {
      callback();
    }
  }
}

// start of index initialization
function initCaptchas(callback) {

  cachedCaptchas = cachedDb.collection('captchas');

  cachedCaptchas.ensureIndex({
    expiration : 1
  }, {
    expireAfterSeconds : 0
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initFlood(callback) {

  cachedFlood = cachedDb.collection('floodRecord');

  cachedFlood.ensureIndex({
    expiration : 1
  }, {
    expireAfterSeconds : 0
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initFlags(callback) {

  cachedFlags = cachedDb.collection('flags');

  cachedFlags.ensureIndex({
    boardUri : 1,
    name : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });

}

function initTorIps(callback) {

  cachedTorIps = cachedDb.collection('torIps');

  cachedTorIps.ensureIndex({
    ip : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initTripcodes(callback) {

  cachedTripcodes = cachedDb.collection('secureTripcodes');

  cachedTripcodes.ensureIndex({
    tripcode : 1
  }, {
    unique : 1
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initHashBans(callback) {

  cachedHashBans = cachedDb.collection('hashBans');

  cachedHashBans.ensureIndex({
    boardUri : 1,
    md5 : 1
  }, {
    unique : 1
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initBans(callback) {

  cachedBans = cachedDb.collection('bans');

  cachedBans.ensureIndex({
    expiration : 1
  }, {
    expireAfterSeconds : 0
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initReports(callback) {
  cachedReports = cachedDb.collection('reports');

  cachedReports.ensureIndex({
    boardUri : 1,
    global : 1,
    threadId : 1,
    postId : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initPosts(callback) {
  cachedPosts = cachedDb.collection('posts');

  cachedPosts.ensureIndex({
    postId : 1,
    boardUri : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initRecoveryRequests(callback) {

  cachedRecoveryRequests = cachedDb.collection('recoveryRequests');

  cachedRecoveryRequests.ensureIndex({
    expiration : 1
  }, {
    expireAfterSeconds : 0
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });

}

function initUsers(callback) {

  cachedUsers = cachedDb.collection('users');

  cachedUsers.ensureIndex({
    login : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });

}

function initThreads(callback) {
  cachedThreads = cachedDb.collection('threads');

  cachedThreads.ensureIndex({
    threadId : 1,
    boardUri : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });
}

function initBoards(callback) {

  cachedBoards = cachedDb.collection('boards');

  cachedBoards.ensureIndex({
    boardUri : 1
  }, {
    unique : true
  }, function setIndex(error, index) {
    if (error) {
      if (loading) {
        loading = false;

        callback(error);
      }
    } else {
      indexSet(callback);
    }
  });

}

// end of index initialization

// start of getters

exports.conn = function() {
  return cachedDb;
};

exports.recoveryRequests = function() {
  return cachedRecoveryRequests;
};

exports.files = function() {
  return cachedFiles;
};

exports.bans = function() {
  return cachedBans;
};

exports.posts = function() {
  return cachedPosts;
};

exports.boards = function() {
  return cachedBoards;
};

exports.users = function() {
  return cachedUsers;
};

exports.threads = function() {
  return cachedThreads;
};

exports.captchas = function() {
  return cachedCaptchas;
};

exports.reports = function() {
  return cachedReports;
};

exports.tripcodes = function() {
  return cachedTripcodes;
};

exports.stats = function() {
  return cachedStats;
};

exports.logs = function() {
  return cachedLog;
};

exports.hashBans = function() {
  return cachedHashBans;
};

exports.torIps = function() {
  return cachedTorIps;
};

exports.flags = function() {
  return cachedFlags;
};

exports.flood = function() {
  return cachedFlood;
};

// end of getters

function checkCollections(db, callback) {

  initBoards(callback);

  initThreads(callback);

  initPosts(callback);

  initUsers(callback);

  initReports(callback);

  initBans(callback);

  initCaptchas(callback);

  initRecoveryRequests(callback);

  initTripcodes(callback);

  initHashBans(callback);

  initTorIps(callback);

  initFlags(callback);

  initFlood(callback);

}

exports.init = function(callback) {

  if (loading) {
    callback('Already booting db');
  }

  loading = true;

  indexesSet = 0;

  var dbSettings = require('./boot').getDbSettings();

  var client = mongo.MongoClient;

  var connectString = 'mongodb://';

  if (dbSettings.user) {
    connectString += dbSettings.user + ':' + dbSettings.password + '@';
  }

  connectString += dbSettings.address + ':';
  connectString += dbSettings.port + '/' + dbSettings.db;

  client.connect(connectString, function connectedDb(error, db) {

    if (error) {
      callback(error);
    } else {

      cachedDb = db;

      cachedFiles = db.collection('fs.files');

      cachedLog = db.collection('staffLogs');

      cachedStats = db.collection('boardStats');

      checkCollections(db, callback);
    }

  });

};
