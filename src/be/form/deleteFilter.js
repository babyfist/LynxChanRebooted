'use strict';

var formOps = require('../engine/formOps');
var url = require('url');
var lang = require('../engine/langOps').languagePack();
var boardOps = require('../engine/boardOps');
var mandatoryParameters = [ 'boardUri', 'filterIdentifier' ];

function deleteFilter(parameters, userData, res) {

  if (formOps.checkBlankParameters(parameters, mandatoryParameters, res)) {
    return;
  }

  boardOps.deleteFilter(userData.login, parameters, function filterDeleted(
      error, filters) {
    if (error) {
      formOps.outputError(error, 500, res);
    } else {
      var redirect = '/filterManagement.js?boardUri=' + parameters.boardUri;
      formOps.outputResponse(lang.msgFilterDeleted, redirect, res);
    }
  });

}

exports.process = function(req, res) {

  formOps.getAuthenticatedPost(req, res, true, function gotData(auth, userData,
      parameters) {

    deleteFilter(parameters, userData, res);

  });

};