"use strict";

var nconf = require('nconf');
var crypto = require('crypto');
var restify = require('restify');
var directLine = require('./lib/directLine.js');

// Required to make rxjs ajax run browser-less
global.XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var config = nconf.argv().env().file({ file: 'localConfig.json' });

var responses = {};

function botSays(activity) {
  console.log(activity);

  var reply = { 
    "version": "1.0",
    "response": {
      "outputSpeech": {
        "type": "PlainText",
        "text": "Nonsense.",
      }
    }
  };

  var res_next = responses[activity.from.id];
  var res = res_next[0]; var next = res_next[1];
  res.send(reply);
  next();
}

function alexaSays(req, res, bot, next) {

    var userId = req.body.session.user.userId;
    var utterance = req.body.request.intent.slots.phrase.value;

    userId = crypto.createHmac('sha256', userId).digest('hex');

    var activity = {
      type : "message",
      text : utterance,
      from : { id : userId },
      locale : "en-US",
      timestamp : (new Date()).toISOString()
    };

    responses[userId] = [ res, next ];
    bot.postActivity(activity)
    .subscribe(id => {
    }, error => {
      console.warn("failed to send postBack", error);
    });

    //next();
}

function startBridge() {

  var opts = { secret : config.get('directLineSecret') };
  var connector = new directLine.DirectLine(opts);
 
  connector.activity$.subscribe(
    botSays,
    error => console.log("activity$ error", error)
  );

  var server = restify.createServer();
  server.use(restify.bodyParser());
  server.post('/messages', (req, res, err) => alexaSays(req, res, connector, err) );

  server.listen(8080, function() {
    console.log('%s listening at %s', server.name, server.url);
  });
}

function main() {
  startBridge();
}

if (require.main === module) {
  main();
}
