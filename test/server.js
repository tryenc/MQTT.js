'use strict'

var net = require('net')
var tls = require('tls')
var Connection = require('mqtt-connection')

/*
 * MqttServer
 *
 * @param {Function} listener - fired on client connection
 */
class MqttServer extends net.Server {
  constructor (listener) {
    that = this
    // set on('connection') listener
    super({}, function (duplex) {
      var connection = new Connection(duplex, function () {
        that.emit('client', connection)
      })
    })

    if (listener) {
      this.on('client', listener)
    }
  }
}

/*
 * MqttServerNoWait (w/o waiting for initialization)
 *
 * @param {Function} listener - fired on client connection
 */
class MqttServerNoWait extends net.Server {
  constructor (listener) {
    super({}, function (duplex) {
      var connection = new Connection(duplex)
      // do not wait for connection to return to send it to the client.
      this.emit('client', connection)
    })

    if (listener) {
      this.on('client', listener)
    }
  }
}

/**
 * MqttSecureServer
 *
 * @param {Object} opts - server options
 * @param {Function} listener
 */
class MqttSecureServer extends tls.Server {
  constructor (opts, listener) {
    if (typeof opts === 'function') {
      listener = opts
      opts = {}
    }

    serverThat = this

    // sets a listener for the 'connection' event
    super(opts, function (socket) {
      serverThat.socket = socket
      var that = this
      var connection = new Connection(socket, function () {
        that.emit('client', connection)
      })
    })

    if (listener) {
      this.on('client', listener)
    }

    this.on('secureConnection', )
  }

  static setupConnection (duplex) {
    var that = this
    var connection = new Connection(duplex, function () {
      that.emit('client', connection)
    })
  }
}

exports.MqttServer = MqttServer
exports.MqttServerNoWait = MqttServerNoWait
exports.MqttSecureServer = MqttSecureServer
