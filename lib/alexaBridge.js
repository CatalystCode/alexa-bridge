"use strict";

// Connects to AppInsights comment out the following three lines if you aren't using appinsights
var appInsights = require('applicationinsights');
appInsights.setup(process.env.APPINSIGHTS_INSTRUMENTATIONKEY).start(); // reads in from APPINSIGHTS_INSTRUMENTATIONKEY by default in the .env file
let client = appInsights.defaultClient;

var util = require('util');
var crypto = require('crypto');
var restify = require('restify');
var directLine = require('botframework-directlinejs');
var request = require('request');

// This loads the environment variables from the .env file - updated from .config for continuous deployment
require('dotenv-extended').load();

// Required to make rxjs ajax run browser-less
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var config = {}
config.botId = process.env.botId
config.directLineSecret = process.env.directLineSecret
config.domain = process.env.directLineDomain || "https://directline.botframework.com/v3/directline"

var responses = {};
var msgParts = {};
var botId = config.botId;

// Send our reply to Alexa
function sendReply(replyToId) {
  var res_next = responses[replyToId];
  var res = res_next[0];
  var next = res_next[1];
  var reply = res_next[2];
  delete responses[replyToId];
  delete msgParts[replyToId];

  if (res.send) {
    res.send(reply);
    next();
  }
}

function removeDuplicatesBy(keyFn, array) {
  var mySet = new Set();
  return array.filter(function (x) {
    var key = keyFn(x), isNew = !mySet.has(key);
    if (isNew) mySet.add(key);
    return isNew;
  });
}

// We can have a bunch of messages in state that need to be concatenated into 1 single response for Alexa
// Here we append them to one another and send the response formatted json.  There can be duplicates if 
// for example a typing activity (busy) activity has been sent - so these need stripping
function createAlexaReply(activity) {
  // Remove any duplicate messages
  var removeDups = removeDuplicatesBy(x => x.text, msgParts[activity.replyToId]);

  // Create one big long output string to send to Alexa
  var textOutput = removeDups.reduce(function (a, b) { return a.concat(b.text, ".  ") }, "");
  var speakOutput = removeDups.reduce(function (a, b) { return ((b.speak) ? a.concat(b.speak, ".  ") : a.concat(b.text, ".  ")) }, "");
  console.log("Alexa message out: " + textOutput);

  var reply = {
    "version": "1.0",
    "response": {
      "outputSpeech": {
        "type": (activity.speak) ? "SSML" : "PlainText",
        "text": textOutput,
        "ssml": (speakOutput) ? ("<speak>" + speakOutput + "</speak>") : null
      },
      "reprompt": {
        "outputSpeech": {
          "type": "PlainText",
          "text": process.env.promptPhrase || "Can I help you with anything else?"  // provides the prompt phrase if the user doesn't ask another question after the first answer is send to them
        }
      },
      //"shouldEndSession" : activity.inputHint == 'expectingInput'
      "shouldEndSession": ((activity.inputHint) && (activity.inputHint == 'expectingInput'))
        ? false // Looks for inputHints on the incoming activity from the bot and checks for 'éxpectingInput', which will leave the session open.
        : ((process.env.leaveSessionOpen && process.env.leaveSessionOpen == 'true') ? false : true)   // If no inputHint is found then check if the 'leaveSessionOpen' app setting exists and is set to 'true' - if it is leave the session open, otherwise close the session by default
    }
  };

  if (process.env.useHeroCardAttachmentAsAlexaCard
    && process.env.useHeroCardAttachmentAsAlexaCard == 'true'
    && activity.attachments && activity.attachments[0]
    && activity.attachments[0].contentType == "application/vnd.microsoft.card.hero") {
    var card = {
      "type": "Standard",
      "title": activity.attachments[0].content.title,
      "text": activity.attachments[0].content.text,
      "image": {
        "smallImageUrl": activity.attachments[0].content.images[0].url,
        "largeImageUrl": activity.attachments[0].content.images[0].url
      }
    };

    reply.response.card = card;
  }

  return reply;
}

function createAlexaProgressReply(requestId) {
  var reply = {
    "header": {
      "requestId": requestId
    },
    "directive": {
      "type": "VoicePlayer.Speak",
      "speech": process.env.progressiveResponse || "Working on it"
    }
  }
  return reply;
}

function createAlexaSessionEndReply() {
  var reply = {
    "version": "1.0",
    "response": {
      "outputSpeech": {
        "type": "PlainText",
        "text": ""
      },
      "shouldEndSession": true  // close the bridge to avoid the "there was a problem with the requested skills response" message from being played after timeout
    }
  };
  return reply;
}

// Messages back from the bot to Alexa
// There can be multiple responses back from the bot from a single request.  Problem is that with Alexa we can only send 1 response
// back, so how do we know when the bot is finished replying?  If your bot is written to only respond with 1 reply to every request this 
// isn't a problem, if not we attempt to queue up all the messages from the bot and send them in one payload back to Alexa.  However,
// we're against the clock as Alexa will timeout - therefore you can experiment with the timeout setting which will be a comprise of speed of 
// response to Alexa vs your bot having enough time to finish responding here and to forward on to send on to Alexa.
function botSays(activity) {
  let startTime = Date.now();
  console.log("Subscribe event: " + activity.replyToId + " from: " + activity.from.id + " message: " + activity.text);
  //console.log(util.inspect(activity, false, null));

  // When you only have exactly 1 bot response per user request you can safely do this - otherwise you'll need to support
  // multiple messages coming back from the bot.  However, if message is a user prompt - then we don't want to delay
  if ((process.env.useMultipleResponses == 'false' || activity.inputHint == 'expectingInput') && activity.replyToId in responses) {
    msgParts[activity.replyToId] = [activity];
    var reply = createAlexaReply(activity);
    responses[activity.replyToId].push(reply);

    let alexaResponseDuration = Date.now() - startTime;
    if (client) {
      client.trackMetric({ name: "Alexa Response Duration", value: alexaResponseDuration });
    }
    console.log("Alexa Response Duration: " + alexaResponseDuration);

    sendReply(activity.replyToId);
    return;
  }

  if (activity.replyToId in msgParts) {
    // Back once again for the renegade master - store additional responses but send them when they've all had chance to come in
    msgParts[activity.replyToId].push(activity);
  }
  else {
    msgParts[activity.replyToId] = [activity];

    // Max time to wait for all bot responses to come back before we ship them off to Alexa
    // You can play with the timeout value depending on how long your responses take to come back from your
    // bot in the case of long running processes.  However, you must get something back to Alexa within <8 secs
    setTimeout(function () {

      var reply = createAlexaReply(activity);

      // Double check we've got the original request message - otherwise we have nothing to respond to and it's gameover for this message
      if (activity.replyToId in responses) {
        responses[activity.replyToId].push(reply);

        let alexaResponseDuration = Date.now() - startTime;
        if (client) {
          client.trackMetric({ name: "Alexa Response Duration", value: alexaResponseDuration });
        }
        console.log("Alexa Response Duration: " + alexaResponseDuration);

        sendReply(activity.replyToId);
      }
      else {
        // Didn't receive this one in time :(
        if (client){
          client.trackEvent({name: "Missed message", properties: {"activity.replyToId": activity.replyToId, "activity.text" : activity.text}});
        }
        console.log("Missed message (not received before timeout): " + activity.replyToId + ": " + activity.text)
      }
    }, process.env.multipleResponsesTimeout);
  }
}

// Alexa called :)
function alexaIntent(req, res, bot, next) {
  let startTime = Date.now();

  var userId = req.body.session.user.userId;

  // Substitute Amazon's default built-in intents - choose how you want to implement these eg. in LUIS
  var utterance = "";
  switch (req.body.request.intent.name) {
    case "AMAZON.HelpIntent":
      utterance = "Help";
      break;
    case "AMAZON.CancelIntent":
      utterance = "Cancel"
      break;
    case "AMAZON.StopIntent":
      utterance = "Stop"
      break;
    default:
      utterance = req.body.request.intent.slots.phrase.value;
  }

  console.log("Alexa utterance: " + utterance);

  // Bot SDK seems to have some hidden rules regarding valid userId
  // so doing this works around those (else we get 400's)
  userId = crypto.createHmac('md5', userId).digest('hex');

  var channelData = {
    session_sessionId: (req.body.session.sessionId) ? req.body.session.sessionId : null,
    user_userId: (req.body.session.user.userId) ? req.body.session.user.userId : null,
    user_accessToken: (req.body.session.user.accessToken) ? req.body.session.user.accessToken : null,
    user_permissions: (req.body.session.user.permissions) ? req.body.session.user.permissions : null,
    alexa_apiAccessToken: (req.body.context.System.apiAccessToken) ? req.body.context.System.apiAccessToken : null,
    alexa_apiEndpoint: (req.body.context.System.apiEndpoint) ? req.body.context.System.apiEndpoint : null,
    device: (req.body.context.System.device) ? req.body.context.System.device : null,
    alexa_requestId: (req.body.request.requestId) ? req.body.request.requestId : null
  };

  var activity = {
    type: "message",
    text: utterance,
    from: { id: userId },
    locale: process.env.msglocale || "en-US",
    timestamp: (new Date()).toISOString(),
    channelData: channelData
  };

  // Forward the activity to our Bot
  bot.postActivity(activity)
    .subscribe(id => {
      if (id != 'retry') {

        let duration = Date.now() - startTime;
        if (client) {
          client.trackMetric({ name: "connector response time", value: duration });
        }
        console.log("connector response time: " + duration);

        // Store the response objects
        responses[id] = [res, next];

        if (activity.channelData) {
          var busyReply = createAlexaProgressReply(channelData.alexa_requestId);
          var auth = "Bearer " + activity.channelData.alexa_apiAccessToken;

          var headers = {
            'Authorization': "Bearer " + activity.channelData.alexa_apiAccessToken
          };

          request.post({ url: activity.channelData.alexa_apiEndpoint + '/v1/directives', headers: headers, json: busyReply },
            function (error, response, body) {
              console.log(response.statusCode)
              if (!error && response.statusCode == 200) {
                console.log(body)
              }
            });
        }
      }
    }, error => {
      console.warn("failed to send postBack", error);
    });

    let intentDuration = Date.now() - startTime;
    if (client) {
      client.trackMetric({ name: "alexaIntent Duration", value: intentDuration });
    }
    console.log("alexaIntent response time: " + intentDuration);
}

// Alexa is calling us with the utterance
function alexaSays(req, res, bot, next) {
  //console.log("Alexa says:");
  //console.log(util.inspect(req.body, false, null));
  if (req.body && req.body.request && req.body.request.type &&
    req.body.request.type == "IntentRequest") {
    alexaIntent(req, res, bot, next);
  }
  else if (req.body && req.body.request && req.body.request.type &&
    req.body.request.type == "SessionEndedRequest") {
    // the session has likely timed out from Alexa as no response was received after the prompt.
    var reply = createAlexaSessionEndReply();
    console.log("closing the session");
    res.send(reply);
    next();
  }
  else {
    return next(new restify.InvalidArgumentError("Unhandled request type"));
  }
}

function startBridge() {
  var opts = { secret: config.directLineSecret, webSocket: true, domain: config.domain };
  var connector = new directLine.DirectLine(opts);

  connector.activity$
    .filter(activity => activity.type === 'message' && activity.from.id === botId && activity.replyToId)
    .subscribe(
      botSays,
      error => console.log("activity$ error", error)
    );

  var server = restify.createServer();
  server.use(restify.plugins.bodyParser());
  server.post('/messages', (req, res, err) => alexaSays(req, res, connector, err));

  server.listen(process.env.port || process.env.PORT || 8080, function () {
    console.log('%s listening at %s', server.name, server.url);
  });

  return server;
}

module.exports = {
  start: startBridge
};