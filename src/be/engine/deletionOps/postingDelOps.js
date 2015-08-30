'use strict';

var gridFs = require('../gridFsHandler');
var miscOps = require('../miscOps');
var logger = require('../../logger');
var lang = require('../langOps').languagePack();
var db = require('../../db');
var posts = db.posts();
var threads = db.threads();
var logs = db.logs();
var boards = db.boards();
var files = db.files();
var settings = require('../../boot').getGeneralSettings();
var verbose = settings.verbose;
var latestPosts = settings.latestPostCount;

// Section 1: Posting deletion {
function reaggregateLatestPosts(countData, board, parentThreads, callback,
    index) {
  posts.aggregate([ {
    $match : {
      boardUri : board.boardUri,
      threadId : parentThreads[index]
    }
  }, {
    $project : {
      _id : 0,
      creation : 1,
      postId : 1
    }
  }, {
    $sort : {
      creation : -1
    }
  }, {
    $limit : latestPosts
  }, {
    $group : {
      _id : 0,
      ids : {
        $push : '$postId'
      }
    }
  } ], function gotIds(error, results) {
    if (error) {
      callback(error);
    } else {

      var foundPosts = results.length ? results[0].ids : [];

      // style exception, too simple

      threads.update({
        boardUri : board.boardUri,
        threadId : parentThreads[index]
      }, {
        $set : {
          fileCount : countData.fileCount,
          postCount : countData.postCount,
          latestPosts : foundPosts
        }
      }, function setPosts(error) {
        if (error) {
          callback(error);
        } else {
          reaggregateThread(board, parentThreads, callback, index + 1);
        }

      });

      // style exception, too simple

    }

  });
}

function reaggregateThread(board, parentThreads, callback, index) {

  index = index || 0;

  if (index >= parentThreads.length) {
    callback();
    return;
  }

  posts.aggregate([ {
    $match : {
      boardUri : board.boardUri,
      threadId : parentThreads[index]
    }
  }, {
    $project : {
      _id : 0,
      fileCount : {
        $size : {
          $ifNull : [ '$files', [] ]
        }
      }
    }
  }, {
    $group : {
      _id : 0,
      postCount : {
        $sum : 1
      },
      fileCount : {
        $sum : '$fileCount'
      }
    }
  } ], function gotResults(error, results) {

    if (error) {
      callback(error);
    } else {

      var data = results.length ? results[0] : {
        postCount : 0,
        fileCount : 0
      };

      reaggregateLatestPosts(data, board, parentThreads, callback, index);
    }

  });

}

function signalAndLoop(parentThreads, board, userData, parameters,
    threadsToDelete, postsToDelete, foundBoards, callback) {

  for (var i = 0; i < parentThreads.length; i++) {
    var parentThread = parentThreads[i];

    process.send({
      board : board.boardUri,
      thread : parentThread
    });
  }

  process.send({
    board : board.boardUri
  });

  iterateBoardsToDelete(userData, parameters, threadsToDelete, postsToDelete,
      foundBoards, callback);
}

function updateBoardAndThreads(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, callback, foundThreads, parentThreads) {

  boards.update({
    boardUri : board.boardUri
  }, {
    $inc : {
      threadCount : -foundThreads.length
    }
  }, function updatedThreadCount(error) {
    if (error) {
      callback(error);
    } else {
      // style exception, too simple
      reaggregateThread(board, parentThreads, function reaggregated(error) {
        if (error) {
          callback(error);
        } else {
          signalAndLoop(parentThreads, board, userData, parameters,
              threadsToDelete, postsToDelete, foundBoards, callback);

        }
      });
      // style exception, too simple
    }

  });

}

function removeContentFiles(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, cb, foundThreads, foundPosts, parentThreads) {

  files.aggregate([ {
    $match : {
      'metadata.boardUri' : board.boardUri,
      $or : [ {
        'metadata.threadId' : {
          $in : foundThreads
        }
      }, {
        'metadata.postId' : {
          $in : foundPosts
        }
      } ]
    }
  }, {
    $group : {
      _id : 0,
      files : {
        $push : '$filename'
      }
    }
  } ], function gotFiles(error, results) {
    if (error) {
      cb(error);
    } else {
      if (results.length) {

        // style exception, too simple
        gridFs.removeFiles(results[0].files, function deletedFiles(error) {
          if (error) {
            cb(error);
          } else {
            updateBoardAndThreads(userData, board, threadsToDelete,
                postsToDelete, parameters, foundBoards, cb, foundThreads,
                parentThreads);
          }
        });
        // style exception, too simple
      } else {
        updateBoardAndThreads(userData, board, threadsToDelete, postsToDelete,
            parameters, foundBoards, cb, foundThreads, parentThreads);
      }
    }
  });

}

function appendThreadDeletionLog(foundThreads) {

  var logMessage = '';

  if (foundThreads.length) {

    for (var i = 0; i < foundThreads.length; i++) {

      if (i) {
        logMessage += ',';
      }

      logMessage += ' ' + foundThreads[i];

    }

  }

  return logMessage;
}

function appendPostDeletionLog(foundThreads, foundPosts) {

  var logMessage = '';

  if (foundPosts.length) {

    for (var i = 0; i < foundPosts.length; i++) {
      if (i) {
        logMessage += ',';
      }

      logMessage += ' ' + foundPosts[i];
    }

  }

  return logMessage;

}

function logRemoval(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, cb, foundThreads, foundPosts, parentThreads) {

  var pieces = lang.logPostingDeletion;

  var logMessage = pieces.startPiece.replace('{$login}', userData.login);

  var threadList = appendThreadDeletionLog(foundThreads);

  if (threadList.length) {
    logMessage += pieces.threadPiece + threadList;
  }

  var postList = appendPostDeletionLog(foundThreads, foundPosts);

  if (postList.length) {

    if (threadList.length) {
      logMessage += pieces.threadAndPostPiece;
    }

    logMessage += pieces.postPiece;

    logMessage += postList;

  }

  logMessage += pieces.endPiece.replace('{$board}', board.boardUri);

  logs.insert({
    user : userData.login,
    type : 'deletion',
    time : new Date(),
    boardUri : board.boardUri,
    description : logMessage,
    global : userData.globalRole <= miscOps.getMaxStaffRole()
  }, function insertedLog(error) {

    if (error) {

      logger.printLogError(logMessage, error);
    }

    removeContentFiles(userData, board, threadsToDelete, postsToDelete,
        parameters, foundBoards, cb, foundThreads, foundPosts, parentThreads);
  });
}

function removeFoundContent(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, cb, foundThreads, foundPosts, parentThreads) {

  threads.remove({
    boardUri : board.boardUri,
    threadId : {
      $in : foundThreads
    }
  }, function removedThreads(error) {
    if (error) {
      cb(error);
    } else {
      // style exception, too simple

      posts.remove({
        boardUri : board.boardUri,
        postId : {
          $in : foundPosts
        }
      }, function removedPosts(error) {
        if (error) {
          cb(error);
        } else {
          if (userData) {

            logRemoval(userData, board, threadsToDelete, postsToDelete,
                parameters, foundBoards, cb, foundThreads, foundPosts,
                parentThreads, userData);

          } else {

            removeContentFiles(userData, board, threadsToDelete, postsToDelete,
                parameters, foundBoards, cb, foundThreads, foundPosts,
                parentThreads);
          }
        }

      });

      // style exception, too simple
    }

  });

}

function composeQueryBlock(board, threadsToDelete, userData, parameters,
    callback) {
  var threadQueryBlock = {
    boardUri : board.boardUri,
    threadId : {
      $in : threadsToDelete[board.boardUri] || []
    }
  };

  var isOwner;
  var isVolunteer;
  var isOnGLobalStaff;

  if (userData) {
    isOwner = board.owner === userData.login;

    if (board.volunteers) {
      isVolunteer = board.volunteers.indexOf(userData.login) > -1;
    }

    isOnGLobalStaff = userData.globalRole <= miscOps.getMaxStaffRole();

  }

  if (!isOwner && !isVolunteer && !isOnGLobalStaff) {
    if (!parameters.password) {
      return false;
    } else {
      threadQueryBlock.password = parameters.password;
    }
  }

  return threadQueryBlock;
}

function sanitizeParentThreads(foundThreads, rawParents) {

  var parents = [];

  for (var i = 0; i < rawParents.length; i++) {
    var parent = rawParents[i];

    if (foundThreads.indexOf(parent) === -1) {
      parents.push(parent);
    }
  }

  return parents;

}

function getPostsToDelete(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, callback, foundThreads, queryBlock) {

  var orBlock = [ {
    threadId : queryBlock.threadId
  }, {
    postId : {
      $in : postsToDelete[board.boardUri] || []
    }
  } ];

  queryBlock.$or = orBlock;

  delete queryBlock.threadId;

  posts.aggregate([ {
    $match : queryBlock
  }, {
    $project : {
      _id : 0,
      postId : 1,
      threadId : 1
    }
  }, {
    $group : {
      _id : 0,
      posts : {
        $push : '$postId'
      },
      parentThreads : {
        $addToSet : '$threadId'
      }
    }
  } ], function gotPosts(error, results) {
    if (error) {
      callback(error);
    } else {
      var foundPosts = results.length ? results[0].posts : [];

      var parentThreads = results.length ? sanitizeParentThreads(foundThreads,
          results[0].parentThreads) : [];

      removeFoundContent(userData, board, threadsToDelete, postsToDelete,
          parameters, foundBoards, callback, foundThreads, foundPosts,
          parentThreads);
    }
  });

}

function getThreadsToDelete(userData, board, threadsToDelete, postsToDelete,
    parameters, foundBoards, callback) {

  var threadQueryBlock = composeQueryBlock(board, threadsToDelete, userData,
      parameters);

  if (!threadQueryBlock) {
    iterateBoardsToDelete(userData, parameters, threadsToDelete, postsToDelete,
        foundBoards, callback);
    return;
  }

  threads.aggregate([ {
    $match : threadQueryBlock
  }, {
    $project : {
      _id : 0,
      threadId : 1
    }
  }, {
    $group : {
      _id : 0,
      threads : {
        $push : '$threadId'
      }
    }
  } ], function gotThreads(error, results) {
    if (error) {
      callback(error);
    } else {
      var foundThreads = results.length ? results[0].threads : [];

      getPostsToDelete(userData, board, threadsToDelete, postsToDelete,
          parameters, foundBoards, callback, foundThreads, threadQueryBlock);
    }
  });

}

function iterateBoardsToDelete(userData, parameters, threadsToDelete,
    postsToDelete, foundBoards, callback) {

  if (!foundBoards.length) {
    callback();
    return;
  }

  boards.findOne({
    boardUri : foundBoards.shift()
  }, {
    boardUri : 1,
    owner : 1,
    _id : 0,
    volunteers : 1
  }, function gotBoard(error, board) {

    if (error) {
      callback(error);
    } else if (!board) {
      callback(lang.errBoardNotFound);
    } else {
      getThreadsToDelete(userData, board, threadsToDelete, postsToDelete,
          parameters, foundBoards, callback);
    }

  });

}

function printAuth(userData, parameters, threadsToDelete, postsToDelete) {
  if (parameters.password) {
    console.log('Using password ' + parameters.password);
  }

  if (userData) {
    console.log('User identification ' + JSON.stringify(userData, null, 2));
  }

  console.log('Deleting threads: ' + JSON.stringify(threadsToDelete, null, 2));
  console.log('Deleting posts: ' + JSON.stringify(postsToDelete, null, 2));
}

exports.posting = function(userData, parameters, threadsToDelete,
    postsToDelete, callback) {

  var foundBoards = [];

  if (verbose) {

    printAuth(userData, parameters, threadsToDelete, postsToDelete);
  }

  for ( var key in threadsToDelete) {

    if (threadsToDelete.hasOwnProperty(key)) {
      if (foundBoards.indexOf(key) === -1) {
        foundBoards.push(key);
      }
    }

  }

  for (key in postsToDelete) {

    if (postsToDelete.hasOwnProperty(key)) {
      if (foundBoards.indexOf(key) === -1) {
        foundBoards.push(key);
      }
    }

  }

  iterateBoardsToDelete(userData, parameters, threadsToDelete, postsToDelete,
      foundBoards, callback);

};
// } Section 1: Posting deletion

// Section 2: Deletion from ip {

exports.deleteFromIp = function(parameters, userData, callback) {

  var allowed = userData.globalRole <= settings.clearIpMinRole;

  if (!allowed) {

    callback(lang.errDeniedIpDeletion);

    return;
  }

  var ip = parameters.ip.trim().split('.');

  var processedIp = [];

  for (var i = 0; i < ip.length; i++) {

    processedIp.push(+ip[i]);

  }

  var queryBlock = {
    ip : processedIp
  };

  if (parameters.boards) {

    var matches = parameters.boards.toString().match(/\w+/g);

    if (matches) {

      queryBlock.boardUri = {
        $in : matches
      };
    }
  }

  threads.aggregate([ {
    $match : queryBlock
  }, {
    $project : {
      boardUri : 1,
      threadId : 1
    }
  }, {
    $group : {
      _id : '$boardUri',
      threads : {
        $push : '$threadId'
      }
    }
  } ], function gotThreads(error, results) {

    if (error) {
      callback(error);
    } else {

      var foundThreads = {};

      for (var i = 0; i < results.length; i++) {

        var result = results[i];

        foundThreads[result._id] = result.threads;

      }

      // style exception, too simple
      posts.aggregate([ {
        $match : queryBlock
      }, {
        $project : {
          boardUri : 1,
          postId : 1
        }
      }, {
        $group : {
          _id : '$boardUri',
          posts : {
            $push : '$postId'
          }
        }
      } ], function gotPosts(error, results) {
        if (error) {
          callback(error);
        } else {

          var foundPosts = {};

          for (var i = 0; i < results.length; i++) {

            var result = results[i];

            foundPosts[result._id] = result.posts;

          }

          exports.posting(userData, parameters, foundThreads, foundPosts,
              callback);

        }
      });
      // style exception, too simple

    }

  });

};

// } Section 2: Deletion from ip