import template from 'lodash/template';
import * as services from './services';
import { P2PService } from './services';
import e from 'express';

const p2pService = new P2PService();

p2pService.connect();
/*
const outputElement = document.getElementById('output');
if (outputElement) {
  var compiled = template(`
    <h1><%- heading %></h1>
    Current date and time: <%- dateTimeString %>
  `.trim());
  outputElement.innerHTML = compiled({
    heading: 'ts-demo-webpack',
    dateTimeString: new Date().toISOString(),
  });
}*/

'use strict';

// Look after different browser vendors' ways of calling the getUserMedia()
// API method:
// Opera --> getUserMedia
// Chrome --> webkitGetUserMedia
// Firefox --> mozGetUserMedia
//@ts-ignore
navigator.getUserMedia = navigator.getUserMedia ||
//@ts-ignore
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

// Clean-up function:
// collect garbage before unloading browser's window
window.onbeforeunload = function(e){
        hangup();
}

// Data channel information
var sendChannel, receiveChannel;
var sendButton:any = document.getElementById("sendButton");
var sendTextarea:any = document.getElementById("dataChannelSend");
var receiveTextarea:any = document.getElementById("dataChannelReceive");

// HTML5 <video> elements
var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

// Handler associated with Send button
sendButton.onclick = sendData;

// Flags...
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

// WebRTC data structures
// Streams
var localStream;
var remoteStream;
// PeerConnection
var pc;

// PeerConnection ICE protocol configuration (either Firefox or Chrome)
//@ts-ignore
var pc_config = window.mozRTCPeerConnection ?
  {'iceServers':[{'url':'stun:23.21.150.121'}]} : // IP address
  {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};

var pc_constraints = {
  'optional': [
    {'DtlsSrtpKeyAgreement': true}
  ]};

var sdpConstraints = {};

// Let's get started: prompt user for input (room name)
var room = prompt('Enter room name:');

// Connect to signaling server
var socket = io.connect("http://localhost:9000");

// Send 'Create or join' message to singnaling server
if (room !== '') {
  console.log('Create or join room', room);
  socket.emit('create or join', room);
}

// Set getUserMedia constraints
var constraints = {video: true, audio: true};

// From this point on, execution proceeds based on asynchronous events...

// getUserMedia() handlers...

function handleUserMedia(stream) {
        localStream = stream;
        //@ts-ignore
        localVideo.srcObject = stream;
        console.log('Adding local stream.');
        sendMessage({type:'got user media'});
}

function handleUserMediaError(error){
        console.log('navigator.getUserMedia error: ', error);
}

// Server-mediated message exchanging...

// 1. Server-->Client...

// Handle 'created' message coming back from server:
// this peer is the initiator
socket.on('created', function (room){
  console.log('Created room ' + room);
  isInitiator = true;

  // Call getUserMedia()
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log('Getting user media with constraints', constraints);

  checkAndStart();
});

// Handle 'full' message coming back from server:
// this peer arrived too late :-(
socket.on('full', function (room){
  console.log('Room ' + room + ' is full');
});

// Handle 'join' message coming back from server:
// another peer is joining the channel
socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

// Handle 'joined' message coming back from server:
// this is the second peer joining the channel
socket.on('joined', function (room){
  console.log('This peer has joined room ' + room);
  isChannelReady = true;

  // Call getUserMedia()
  navigator.getUserMedia(constraints, handleUserMedia, handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
});

// Server-sent log message...
socket.on('log', function (array){
  console.log.apply(console, array);
});

// Receive message from the other peer via the signaling server
socket.on('message', function (message){
  console.log('Received message:', message);
  if (message.type === 'got user media') {
      checkAndStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({sdpMLineIndex:message.label,
      candidate:message.candidate});
    pc.addIceCandidate(candidate);
  } else if (message.type === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

// 2. Client-->Server

// Send message to the other peer via the signaling server
function sendMessage(message){
  console.log('Sending message: ', message);
  let msg ={};
  if(typeof message === 'object')
  {
    msg = {...message , channel:room}
    console.log(msg)

  }else{
    msg = {message , channel:room}

  }
  socket.emit('message',msg);
}

// Channel negotiation trigger function
function checkAndStart() {
  if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
        createPeerConnection();
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

// PeerConnection management...
function createPeerConnection() {
  try {
    console.log('entro aca!!')
    pc = new RTCPeerConnection(pc_config as any);

    pc.addStream(localStream);

    pc.onicecandidate = handleIceCandidate;
    console.log('Created RTCPeerConnnection with:\n' +
      '  config: \'' + JSON.stringify(pc_config) + '\';\n' +
      '  constraints: \'' + JSON.stringify(pc_constraints) + '\'.');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
      return;
  }

  pc.onaddstream = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;

  if (isInitiator) {
    try {
      // Create a reliable data channel
      sendChannel = pc.createDataChannel("sendDataChannel",
        {reliable: true});
      console.trace('Created send data channel');
    } catch (e) {
      alert('Failed to create data channel. ');
      console.trace('createDataChannel() failed with exception: ' + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onmessage = handleMessage;
    sendChannel.onclose = handleSendChannelStateChange;
  } else { // Joiner
    pc.ondatachannel = gotReceiveChannel;
  }
}

// Data channel management
function sendData() {
  var data = sendTextarea.value;
  if(isInitiator) sendChannel.send(data);
  else receiveChannel.send(data);
  console.trace('Sent data: ' + data);
}

// Handlers...

function gotReceiveChannel(event) {
  console.trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
  console.trace('Received message: ' + event.data);
  receiveTextarea.value += event.data + '\n';
}

function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.trace('Send channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    sendTextarea.disabled = false;
    sendTextarea.focus();
    sendTextarea.placeholder = "";
    sendButton.disabled = false;
  } else {
    sendTextarea.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.trace('Receive channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    sendTextarea.disabled = false;
    sendTextarea.focus();
    sendTextarea.placeholder = "";
            sendButton.disabled = false;
          } else {
            sendTextarea.disabled = true;
            sendButton.disabled = true;
          }
}

// ICE candidates management
function handleIceCandidate(event) {
  console.log('handleIceCandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate});
  } else {
    console.log('End of candidates.');
  }
}

// Create Offer
function doCall() {
  console.log('Creating Offer...');
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Signaling error handler
function onSignalingError(error) {
        console.log('Failed to create signaling message : ' + error.name);
}

// Create Answer
function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

// Remote stream handlers...

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  //@ts-ignore
  remoteVideo.srcObject = event.stream;
  console.log('Remote stream attached!!.');
  remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

// Clean-up functions...

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage({type:'bye'});
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();
  pc = null;
  sendButton.disabled=true;
}