'use strict';
import * as _ from 'lodash';
import {SignalSteps, SocketServerEvents} from '../lib/';
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var remoteStream;
var turnReady;

const pcConfig = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = 'foo';
// Could prompt for room name:
// room = prompt('Enter room name:');

var socket = io.connect();

if (room !== '') {
  socket.emit(SocketServerEvents.Initialize, room);
  console.log('Attempted to create or  join room', room);
}

socket.on(SocketServerEvents.Created, function (room) {
  console.log('Created room ' + room);
  isInitiator = true;
});

socket.on(SocketServerEvents.IsFull, function (room) {
  console.log('Room ' + room + ' is full');
});

socket.on(SocketServerEvents.Join, function (room) {
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

socket.on(SocketServerEvents.Joined, function (room) {
  console.log('joined: ' + room);
  isChannelReady = true;
});

socket.on('log', function (array) {
  console.log.apply(console, array);
});

////////////////////////////////////////////////

function sendMessage(message: Object | string) {
  console.log('Client sending message: ', message);
  const msg = (typeof message === 'object') ?_.set(message, 'channel', room) :{message, channel: room};
  socket.emit(SocketServerEvents.Message, msg);
}

// This client receives a message
socket.on(SocketServerEvents.Message,  (message) => {
  switch (message.type) {
    case SignalSteps.MediaCreated:
      maybeStart();
      break;
    case  SignalSteps.Offer:
      if (!isInitiator && !isStarted) {
        maybeStart();
      }
      pc.setRemoteDescription(new RTCSessionDescription(message));
      doAnswer();
      break;
    case SignalSteps.Answer:
      if (isStarted) {
        pc.setRemoteDescription(new RTCSessionDescription(message));
      }
      break;
    case SignalSteps.Candidate:
      if (isStarted) {
        const candidate = new RTCIceCandidate({
          sdpMLineIndex: message.label,
          candidate: message.candidate
        });
        pc.addIceCandidate(candidate);
      }
      break;
    case SignalSteps.Terminate:
      if (isStarted) {
        handleRemoteHangup();
      }
      break;
  }
});

////////////////////////////////////////////////////

var localVideo = <HTMLVideoElement>document.querySelector('#localVideo');
var remoteVideo = <HTMLVideoElement>document.querySelector('#remoteVideo');

navigator.mediaDevices
  .getUserMedia({
    audio: false,
    video: true
  })
  .then(gotStream)
  .catch(function (e) {
    alert('getUserMedia() error: ' + e.name);
  });

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage({type: SignalSteps.MediaCreated});
  if (isInitiator) {
    maybeStart();
  }
}

var constraints = {
  video: true
};

console.log('Getting user media with constraints', constraints);

if (location.hostname !== 'localhost') {
  requestTurn('https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913');
}

function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
    console.log('isInitiator', isInitiator);
    if (isInitiator) {
      doCall();
    }
  }
}

window.onbeforeunload = function () {
  sendMessage({type: SignalSteps.Terminate});
};

/////////////////////////////////////////////////////////

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(null);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: SignalSteps.Candidate,
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    });
  } else {
    console.log('End of candidates.');
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall() {
  console.log('Sending offer to peer');
  pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
  pc.createAnswer().then(setLocalAndSendMessage, onCreateSessionDescriptionError);
}

function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

function onCreateSessionDescriptionError(error) {
  console.trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].urls.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          urls: 'turn:' + turnServer.username + '@' + turnServer.turn,
          credential: turnServer.password
        } as any);
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleRemoteStreamAdded(event) {
  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage({type:SignalSteps.Terminate});
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}
// @ts-ignore
function stop() {
  isStarted = false;
  pc.close();
  pc = null;
}
