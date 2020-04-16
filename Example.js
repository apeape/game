// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

var Module = Module;






// Redefine these in a --pre-js to override behavior. If you would like to
// remove out() or err() altogether, you can no-op it out to function() {},
// and build with --closure 1 to get Closure optimize out all the uses
// altogether.

function out(text) {
  console.log(text);
}

function err(text) {
  console.error(text);
}

// Override this function in a --pre-js file to get a signal for when
// compilation is ready. In that callback, call the function run() to start
// the program.
function ready() {
    run();
}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)

function ready() {
	try {
		if (typeof ENVIRONMENT_IS_PTHREAD === 'undefined' || !ENVIRONMENT_IS_PTHREAD) run();
	} catch(e) {
		// Suppress the JS throw message that corresponds to Dots unwinding the call stack to run the application. 
		if (e !== 'unwind') throw e;
	}
}

(function(global, module){
    var _allocateArrayOnHeap = function (typedArray) {
        var requiredMemorySize = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        var ptr = _malloc(requiredMemorySize);
        var heapBytes = new Uint8Array(HEAPU8.buffer, ptr, requiredMemorySize);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return heapBytes;
    };
    
    var _allocateStringOnHeap = function (string) {
        var bufferSize = lengthBytesUTF8(string) + 1;
        var ptr = _malloc(bufferSize);
        stringToUTF8(string, ptr, bufferSize);
        return ptr;
    };

    var _freeArrayFromHeap = function (heapBytes) {
        if(typeof heapBytes !== "undefined")
            _free(heapBytes.byteOffset);
    };
    
    var _freeStringFromHeap = function (stringPtr) {
        if(typeof stringPtr !== "undefined")
            _free(stringPtr);
    };

    var _sendMessage = function(message, intArr, floatArr, byteArray) {
        if (!Array.isArray(intArr)) {
            intArr = [];
        }
        if (!Array.isArray(floatArr)) {
            floatArr = [];
        }
        if (!Array.isArray(byteArray)) {
            byteArray = [];
        }
        
        var messageOnHeap, intOnHeap, floatOnHeap, bytesOnHeap;
        try {
            messageOnHeap = _allocateStringOnHeap(message);
            intOnHeap = _allocateArrayOnHeap(new Int32Array(intArr));
            floatOnHeap = _allocateArrayOnHeap(new Float32Array(floatArr));
            bytesOnHeap = _allocateArrayOnHeap(new Uint8Array(byteArray));
            
            _SendMessage(messageOnHeap, intOnHeap.byteOffset, intArr.length, floatOnHeap.byteOffset, floatArr.length, bytesOnHeap.byteOffset, byteArray.length);
        }
        finally {
            _freeStringFromHeap(messageOnHeap);
            _freeArrayFromHeap(intOnHeap);
            _freeArrayFromHeap(floatOnHeap);
            _freeArrayFromHeap(bytesOnHeap);
        }
    };

    global["SendMessage"] = _sendMessage;
    module["SendMessage"] = _sendMessage;
})(this, Module);












/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) throw text;
}

function abort(what) {
  throw what;
}

var tempRet0 = 0;
var setTempRet0 = function(value) {
  tempRet0 = value;
}
var getTempRet0 = function() {
  return tempRet0;
}

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}




// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        if ((u0 & 0xF8) != 0xF0) warnOnce('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      if (u >= 0x200000) warnOnce('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  assert(typeof maxBytesToWrite == 'number', 'stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!');
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}








var GLOBAL_BASE = 1024,
    TOTAL_STACK = 5242880,
    TOTAL_MEMORY = 268435456,
    STATIC_BASE = 1024,
    STACK_BASE = 791232,
    STACKTOP = STACK_BASE,
    STACK_MAX = 6034112
    , DYNAMICTOP_PTR = 790960
    ;


var wasmMaximumMemory = TOTAL_MEMORY;

var wasmMemory = new WebAssembly.Memory({
  'initial': TOTAL_MEMORY >> 16
  , 'maximum': wasmMaximumMemory >> 16
  });

var buffer = wasmMemory.buffer;




var WASM_PAGE_SIZE = 65536;
assert(STACK_BASE % 16 === 0, 'stack must start aligned to 16 bytes, STACK_BASE==' + STACK_BASE);
assert(TOTAL_MEMORY >= TOTAL_STACK, 'TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');
assert((6034112) % 16 === 0, 'heap must start aligned to 16 bytes, DYNAMIC_BASE==' + 6034112);
assert(TOTAL_MEMORY % WASM_PAGE_SIZE === 0);
assert(buffer.byteLength === TOTAL_MEMORY);

var HEAP8 = new Int8Array(buffer);
var HEAP16 = new Int16Array(buffer);
var HEAP32 = new Int32Array(buffer);
var HEAPU8 = new Uint8Array(buffer);
var HEAPU16 = new Uint16Array(buffer);
var HEAPU32 = new Uint32Array(buffer);
var HEAPF32 = new Float32Array(buffer);
var HEAPF64 = new Float64Array(buffer);



  HEAP32[DYNAMICTOP_PTR>>2] = 6034112;



// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  assert((STACK_MAX & 3) == 0);
  HEAPU32[(STACK_MAX >> 2)-1] = 0x02135467;
  HEAPU32[(STACK_MAX >> 2)-2] = 0x89BACDFE;
}

function checkStackCookie() {
  if (HEAPU32[(STACK_MAX >> 2)-1] != 0x02135467 || HEAPU32[(STACK_MAX >> 2)-2] != 0x89BACDFE) {
    abort('Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x' + HEAPU32[(STACK_MAX >> 2)-2].toString(16) + ' ' + HEAPU32[(STACK_MAX >> 2)-1].toString(16));
  }
  // Also test the global address 0 for integrity.
  if (HEAP32[0] !== 0x63736d65 /* 'emsc' */) throw 'Runtime error: The application has corrupted its heap memory area (address zero)!';
}



  HEAP32[0] = 0x63736d65; /* 'emsc' */




// Endianness check (note: assumes compiler arch was little-endian)
HEAP16[1] = 0x6373;
if (HEAPU8[2] !== 0x73 || HEAPU8[3] !== 0x63) throw 'Runtime error: expected the system to be little-endian!';

function abortFnPtrError(ptr, sig) {
	var possibleSig = '';
	for(var x in debug_tables) {
		var tbl = debug_tables[x];
		if (tbl[ptr]) {
			possibleSig += 'as sig "' + x + '" pointing to function ' + tbl[ptr] + ', ';
		}
	}
	abort("Invalid function pointer " + ptr + " called with signature '" + sig + "'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this). This pointer might make sense in another type signature: " + possibleSig);
}

function wrapAssertRuntimeReady(func) {
  var realFunc = asm[func];
  asm[func] = function() {
    assert(runtimeInitialized, 'you need to wait for the runtime to be ready (e.g. wait for main() to be called)');
    assert(!runtimeExited, 'the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)');
    return realFunc.apply(null, arguments);
  }
}




var runtimeInitialized = false;

// This is always false in minimal_runtime - the runtime does not have a concept of exiting (keeping this variable here for now since it is referenced from generated code)
var runtimeExited = false;

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}


assert(Math.imul, 'This browser does not support Math.imul(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.fround, 'This browser does not support Math.fround(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.clz32, 'This browser does not support Math.clz32(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');
assert(Math.trunc, 'This browser does not support Math.trunc(), build with LEGACY_VM_SUPPORT or POLYFILL_OLD_MATH_FUNCTIONS to add in a polyfill');

var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



var memoryInitializer = null;


// Copyright 2015 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.




// === Body ===

var ASM_CONSTS = [function() { debugger; }];

function _emscripten_asm_const_i(code) {
  return ASM_CONSTS[code]();
}




// STATICTOP = STATIC_BASE + 790208;









/* no memory initializer */
var tempDoublePtr = 791216
assert(tempDoublePtr % 8 == 0);

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  function abortStackOverflow(allocSize) {
      abort('Stack overflow! Attempted to allocate ' + allocSize + ' bytes on the stack, but stack has only ' + (STACK_MAX - stackSave() + allocSize) + ' bytes available!');
    }

  function warnOnce(text) {
      if (!warnOnce.shown) warnOnce.shown = {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        err(text);
      }
    }

  
  var UnityPeerJS={peers:[],peer_min_js:null};function _ConnClose(peerInstance, connInstance) {
  
          var peer = UnityPeerJS.peers[peerInstance];
          var conn = peer.conns[connInstance];
  
          conn.close();
      }

  function _Init() {
      if (UnityPeerJS.peer_min_js != null)
          return;
  
      UnityPeerJS.peer_min_js =
  /*! peerjs build:0.3.14, production. Copyright(c) 2013 Michelle Bu <michelle@michellebu.com> */!function a(b,c,d){function e(g,h){if(!c[g]){if(!b[g]){var i="function"==typeof require&&require;if(!h&&i)return i(g,!0);if(f)return f(g,!0);var j=new Error("Cannot find module '"+g+"'");throw j.code="MODULE_NOT_FOUND",j}var k=c[g]={exports:{}};b[g][0].call(k.exports,function(a){var c=b[g][1][a];return e(c?c:a)},k,k.exports,a,b,c,d)}return c[g].exports}for(var f="function"==typeof require&&require,g=0;g<d.length;g++)e(d[g]);return e}({1:[function(a,b){b.exports.RTCSessionDescription=window.RTCSessionDescription||window.mozRTCSessionDescription,b.exports.RTCPeerConnection=window.RTCPeerConnection||window.mozRTCPeerConnection||window.webkitRTCPeerConnection,b.exports.RTCIceCandidate=window.RTCIceCandidate||window.mozRTCIceCandidate},{}],2:[function(a,b){function c(a,b,g){return this instanceof c?(e.call(this),this.options=d.extend({serialization:"binary",reliable:!1},g),this.open=!1,this.type="data",this.peer=a,this.provider=b,this.id=this.options.connectionId||c._idPrefix+d.randomToken(),this.label=this.options.label||this.id,this.metadata=this.options.metadata,this.serialization=this.options.serialization,this.reliable=this.options.reliable,this._buffer=[],this._buffering=!1,this.bufferSize=0,this._chunkedData={},this.options._payload&&(this._peerBrowser=this.options._payload.browser),void f.startConnection(this,this.options._payload||{originator:!0})):new c(a,b,g)}var d=a("./util"),e=a("eventemitter3"),f=a("./negotiator"),g=a("reliable");d.inherits(c,e),c._idPrefix="dc_",c.prototype.initialize=function(a){this._dc=this.dataChannel=a,this._configureDataChannel()},c.prototype._configureDataChannel=function(){var a=this;d.supports.sctp&&(this._dc.binaryType="arraybuffer"),this._dc.onopen=function(){d.log("Data channel connection success"),a.open=!0,a.emit("open")},!d.supports.sctp&&this.reliable&&(this._reliable=new g(this._dc,d.debug)),this._reliable?this._reliable.onmessage=function(b){a.emit("data",b)}:this._dc.onmessage=function(b){a._handleDataMessage(b)},this._dc.onclose=function(){d.log("DataChannel closed for:",a.peer),a.close()}},c.prototype._handleDataMessage=function(a){var b=this,c=a.data,e=c.constructor;if("binary"===this.serialization||"binary-utf8"===this.serialization){if(e===Blob)return void d.blobToArrayBuffer(c,function(a){c=d.unpack(a),b.emit("data",c)});if(e===ArrayBuffer)c=d.unpack(c);else if(e===String){var f=d.binaryStringToArrayBuffer(c);c=d.unpack(f)}}else"json"===this.serialization&&(c=JSON.parse(c));if(c.__peerData){var g=c.__peerData,h=this._chunkedData[g]||{data:[],count:0,total:c.total};return h.data[c.n]=c.data,h.count+=1,h.total===h.count&&(delete this._chunkedData[g],c=new Blob(h.data),this._handleDataMessage({data:c})),void(this._chunkedData[g]=h)}this.emit("data",c)},c.prototype.close=function(){this.open&&(this.open=!1,f.cleanup(this),this.emit("close"))},c.prototype.send=function(a,b){if(!this.open)return void this.emit("error",new Error("Connection is not open. You should listen for the `open` event before sending messages."));if(this._reliable)return void this._reliable.send(a);var c=this;if("json"===this.serialization)this._bufferedSend(JSON.stringify(a));else if("binary"===this.serialization||"binary-utf8"===this.serialization){var e=d.pack(a),f=d.chunkedBrowsers[this._peerBrowser]||d.chunkedBrowsers[d.browser];if(f&&!b&&e.size>d.chunkedMTU)return void this._sendChunks(e);d.supports.sctp?d.supports.binaryBlob?this._bufferedSend(e):d.blobToArrayBuffer(e,function(a){c._bufferedSend(a)}):d.blobToBinaryString(e,function(a){c._bufferedSend(a)})}else this._bufferedSend(a)},c.prototype._bufferedSend=function(a){(this._buffering||!this._trySend(a))&&(this._buffer.push(a),this.bufferSize=this._buffer.length)},c.prototype._trySend=function(a){try{this._dc.send(a)}catch(b){this._buffering=!0;var c=this;return setTimeout(function(){c._buffering=!1,c._tryBuffer()},100),!1}return!0},c.prototype._tryBuffer=function(){if(0!==this._buffer.length){var a=this._buffer[0];this._trySend(a)&&(this._buffer.shift(),this.bufferSize=this._buffer.length,this._tryBuffer())}},c.prototype._sendChunks=function(a){for(var b=d.chunk(a),c=0,e=b.length;e>c;c+=1){var a=b[c];this.send(a,!0)}},c.prototype.handleMessage=function(a){var b=a.payload;switch(a.type){case"ANSWER":this._peerBrowser=b.browser,f.handleSDP(a.type,this,b.sdp);break;case"CANDIDATE":f.handleCandidate(this,b.candidate);break;default:d.warn("Unrecognized message type:",a.type,"from peer:",this.peer)}},b.exports=c},{"./negotiator":5,"./util":8,eventemitter3:9,reliable:12}],3:[function(a){window.Socket=a("./socket"),window.MediaConnection=a("./mediaconnection"),window.DataConnection=a("./dataconnection"),window.Peer=a("./peer"),window.RTCPeerConnection=a("./adapter").RTCPeerConnection,window.RTCSessionDescription=a("./adapter").RTCSessionDescription,window.RTCIceCandidate=a("./adapter").RTCIceCandidate,window.Negotiator=a("./negotiator"),window.util=a("./util"),window.BinaryPack=a("js-binarypack")},{"./adapter":1,"./dataconnection":2,"./mediaconnection":4,"./negotiator":5,"./peer":6,"./socket":7,"./util":8,"js-binarypack":10}],4:[function(a,b){function c(a,b,g){return this instanceof c?(e.call(this),this.options=d.extend({},g),this.open=!1,this.type="media",this.peer=a,this.provider=b,this.metadata=this.options.metadata,this.localStream=this.options._stream,this.id=this.options.connectionId||c._idPrefix+d.randomToken(),void(this.localStream&&f.startConnection(this,{_stream:this.localStream,originator:!0}))):new c(a,b,g)}var d=a("./util"),e=a("eventemitter3"),f=a("./negotiator");d.inherits(c,e),c._idPrefix="mc_",c.prototype.addStream=function(a){d.log("Receiving stream",a),this.remoteStream=a,this.emit("stream",a)},c.prototype.handleMessage=function(a){var b=a.payload;switch(a.type){case"ANSWER":f.handleSDP(a.type,this,b.sdp),this.open=!0;break;case"CANDIDATE":f.handleCandidate(this,b.candidate);break;default:d.warn("Unrecognized message type:",a.type,"from peer:",this.peer)}},c.prototype.answer=function(a){if(this.localStream)return void d.warn("Local stream already exists on this MediaConnection. Are you answering a call twice?");this.options._payload._stream=a,this.localStream=a,f.startConnection(this,this.options._payload);for(var b=this.provider._getMessages(this.id),c=0,e=b.length;e>c;c+=1)this.handleMessage(b[c]);this.open=!0},c.prototype.close=function(){this.open&&(this.open=!1,f.cleanup(this),this.emit("close"))},b.exports=c},{"./negotiator":5,"./util":8,eventemitter3:9}],5:[function(a,b){var c=a("./util"),d=a("./adapter").RTCPeerConnection,e=a("./adapter").RTCSessionDescription,f=a("./adapter").RTCIceCandidate,g={pcs:{data:{},media:{}},queue:[]};g._idPrefix="pc_",g.startConnection=function(a,b){var d=g._getPeerConnection(a,b);if("media"===a.type&&b._stream&&d.addStream(b._stream),a.pc=a.peerConnection=d,b.originator){if("data"===a.type){var e={};c.supports.sctp||(e={reliable:b.reliable});var f=d.createDataChannel(a.label,e);a.initialize(f)}c.supports.onnegotiationneeded||g._makeOffer(a)}else g.handleSDP("OFFER",a,b.sdp)},g._getPeerConnection=function(a,b){g.pcs[a.type]||c.error(a.type+" is not a valid connection type. Maybe you overrode the `type` property somewhere."),g.pcs[a.type][a.peer]||(g.pcs[a.type][a.peer]={});{var d;g.pcs[a.type][a.peer]}return b.pc&&(d=g.pcs[a.type][a.peer][b.pc]),d&&"stable"===d.signalingState||(d=g._startPeerConnection(a)),d},g._startPeerConnection=function(a){c.log("Creating RTCPeerConnection.");var b=g._idPrefix+c.randomToken(),e={};"data"!==a.type||c.supports.sctp?"media"===a.type&&(e={optional:[{DtlsSrtpKeyAgreement:!0}]}):e={optional:[{RtpDataChannels:!0}]};var f=new d(a.provider.options.config,e);return g.pcs[a.type][a.peer][b]=f,g._setupListeners(a,f,b),f},g._setupListeners=function(a,b){var d=a.peer,e=a.id,f=a.provider;c.log("Listening for ICE candidates."),b.onicecandidate=function(b){b.candidate&&(c.log("Received ICE candidates for:",a.peer),f.socket.send({type:"CANDIDATE",payload:{candidate:b.candidate,type:a.type,connectionId:a.id},dst:d}))},b.oniceconnectionstatechange=function(){switch(b.iceConnectionState){case"disconnected":case"failed":c.log("iceConnectionState is disconnected, closing connections to "+d),a.close();break;case"completed":b.onicecandidate=c.noop}},b.onicechange=b.oniceconnectionstatechange,c.log("Listening for `negotiationneeded`"),b.onnegotiationneeded=function(){c.log("`negotiationneeded` triggered"),"stable"==b.signalingState?g._makeOffer(a):c.log("onnegotiationneeded triggered when not stable. Is another connection being established?")},c.log("Listening for data channel"),b.ondatachannel=function(a){c.log("Received data channel");var b=a.channel,g=f.getConnection(d,e);g.initialize(b)},c.log("Listening for remote stream"),b.onaddstream=function(a){c.log("Received remote stream");var b=a.stream,g=f.getConnection(d,e);"media"===g.type&&g.addStream(b)}},g.cleanup=function(a){c.log("Cleaning up PeerConnection to "+a.peer);var b=a.pc;!b||"closed"===b.readyState&&"closed"===b.signalingState||(b.close(),a.pc=null)},g._makeOffer=function(a){var b=a.pc;b.createOffer(function(d){c.log("Created offer."),!c.supports.sctp&&"data"===a.type&&a.reliable&&(d.sdp=Reliable.higherBandwidthSDP(d.sdp)),b.setLocalDescription(d,function(){c.log("Set localDescription: offer","for:",a.peer),a.provider.socket.send({type:"OFFER",payload:{sdp:d,type:a.type,label:a.label,connectionId:a.id,reliable:a.reliable,serialization:a.serialization,metadata:a.metadata,browser:c.browser},dst:a.peer})},function(b){a.provider.emitError("webrtc",b),c.log("Failed to setLocalDescription, ",b)})},function(b){a.provider.emitError("webrtc",b),c.log("Failed to createOffer, ",b)},a.options.constraints)},g._makeAnswer=function(a){var b=a.pc;b.createAnswer(function(d){c.log("Created answer."),!c.supports.sctp&&"data"===a.type&&a.reliable&&(d.sdp=Reliable.higherBandwidthSDP(d.sdp)),b.setLocalDescription(d,function(){c.log("Set localDescription: answer","for:",a.peer),a.provider.socket.send({type:"ANSWER",payload:{sdp:d,type:a.type,connectionId:a.id,browser:c.browser},dst:a.peer})},function(b){a.provider.emitError("webrtc",b),c.log("Failed to setLocalDescription, ",b)})},function(b){a.provider.emitError("webrtc",b),c.log("Failed to create answer, ",b)})},g.handleSDP=function(a,b,d){d=new e(d);var f=b.pc;c.log("Setting remote description",d),f.setRemoteDescription(d,function(){c.log("Set remoteDescription:",a,"for:",b.peer),"OFFER"===a&&g._makeAnswer(b)},function(a){b.provider.emitError("webrtc",a),c.log("Failed to setRemoteDescription, ",a)})},g.handleCandidate=function(a,b){var d=b.candidate,e=b.sdpMLineIndex;a.pc.addIceCandidate(new f({sdpMLineIndex:e,candidate:d})),c.log("Added ICE candidate for:",a.peer)},b.exports=g},{"./adapter":1,"./util":8}],6:[function(a,b){function c(a,b){return this instanceof c?(e.call(this),a&&a.constructor==Object?(b=a,a=void 0):a&&(a=a.toString()),b=d.extend({debug:0,host:d.CLOUD_HOST,port:d.CLOUD_PORT,key:"peerjs",path:"/",token:d.randomToken(),config:d.defaultConfig},b),this.options=b,"/"===b.host&&(b.host=window.location.hostname),"/"!==b.path[0]&&(b.path="/"+b.path),"/"!==b.path[b.path.length-1]&&(b.path+="/"),void 0===b.secure&&b.host!==d.CLOUD_HOST&&(b.secure=d.isSecure()),b.logFunction&&d.setLogFunction(b.logFunction),d.setLogLevel(b.debug),d.supports.audioVideo||d.supports.data?d.validateId(a)?d.validateKey(b.key)?b.secure&&"0.peerjs.com"===b.host?void this._delayedAbort("ssl-unavailable","The cloud server currently does not support HTTPS. Please run your own PeerServer to use HTTPS."):(this.destroyed=!1,this.disconnected=!1,this.open=!1,this.connections={},this._lostMessages={},this._initializeServerConnection(),void(a?this._initialize(a):this._retrieveId())):void this._delayedAbort("invalid-key",'API KEY "'+b.key+'" is invalid'):void this._delayedAbort("invalid-id",'ID "'+a+'" is invalid'):void this._delayedAbort("browser-incompatible","The current browser does not support WebRTC")):new c(a,b)}var d=a("./util"),e=a("eventemitter3"),f=a("./socket"),g=a("./mediaconnection"),h=a("./dataconnection");d.inherits(c,e),c.prototype._initializeServerConnection=function(){var a=this;this.socket=new f(this.options.secure,this.options.host,this.options.port,this.options.path,this.options.key),this.socket.on("message",function(b){a._handleMessage(b)}),this.socket.on("error",function(b){a._abort("socket-error",b)}),this.socket.on("disconnected",function(){a.disconnected||(a.emitError("network","Lost connection to server."),a.disconnect())}),this.socket.on("close",function(){a.disconnected||a._abort("socket-closed","Underlying socket is already closed.")})},c.prototype._retrieveId=function(){var a=this,b=new XMLHttpRequest,c=this.options.secure?"https://":"http://",e=c+this.options.host+":"+this.options.port+this.options.path+this.options.key+"/id",f="?ts="+(new Date).getTime()+Math.random();e+=f,b.open("get",e,!0),b.onerror=function(b){d.error("Error retrieving ID",b);var c="";"/"===a.options.path&&a.options.host!==d.CLOUD_HOST&&(c=" If you passed in a `path` to your self-hosted PeerServer, you'll also need to pass in that same path when creating a new Peer."),a._abort("server-error","Could not get an ID from the server."+c)},b.onreadystatechange=function(){return 4===b.readyState?200!==b.status?void b.onerror():void a._initialize(b.responseText):void 0},b.send(null)},c.prototype._initialize=function(a){this.id=a,this.socket.start(this.id,this.options.token)},c.prototype._handleMessage=function(a){var b,c=a.type,e=a.payload,f=a.src;switch(c){case"OPEN":this.emit("open",this.id),this.open=!0;break;case"ERROR":this._abort("server-error",e.msg);break;case"ID-TAKEN":this._abort("unavailable-id","ID `"+this.id+"` is taken");break;case"INVALID-KEY":this._abort("invalid-key",'API KEY "'+this.options.key+'" is invalid');break;case"LEAVE":d.log("Received leave message from",f),this._cleanupPeer(f);break;case"EXPIRE":this.emitError("peer-unavailable","Could not connect to peer "+f);break;case"OFFER":var i=e.connectionId;if(b=this.getConnection(f,i))d.warn("Offer received for existing Connection ID:",i);else{if("media"===e.type)b=new g(f,this,{connectionId:i,_payload:e,metadata:e.metadata}),this._addConnection(f,b),this.emit("call",b);else{if("data"!==e.type)return void d.warn("Received malformed connection type:",e.type);b=new h(f,this,{connectionId:i,_payload:e,metadata:e.metadata,label:e.label,serialization:e.serialization,reliable:e.reliable}),this._addConnection(f,b),this.emit("connection",b)}for(var j=this._getMessages(i),k=0,l=j.length;l>k;k+=1)b.handleMessage(j[k])}break;default:if(!e)return void d.warn("You received a malformed message from "+f+" of type "+c);var m=e.connectionId;b=this.getConnection(f,m),b&&b.pc?b.handleMessage(a):m?this._storeMessage(m,a):d.warn("You received an unrecognized message:",a)}},c.prototype._storeMessage=function(a,b){this._lostMessages[a]||(this._lostMessages[a]=[]),this._lostMessages[a].push(b)},c.prototype._getMessages=function(a){var b=this._lostMessages[a];return b?(delete this._lostMessages[a],b):[]},c.prototype.connect=function(a,b){if(this.disconnected)return d.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect, or call reconnect on this peer if you believe its ID to still be available."),void this.emitError("disconnected","Cannot connect to new Peer after disconnecting from server.");var c=new h(a,this,b);return this._addConnection(a,c),c},c.prototype.call=function(a,b,c){if(this.disconnected)return d.warn("You cannot connect to a new Peer because you called .disconnect() on this Peer and ended your connection with the server. You can create a new Peer to reconnect."),void this.emitError("disconnected","Cannot connect to new Peer after disconnecting from server.");if(!b)return void d.error("To call a peer, you must provide a stream from your browser's `getUserMedia`.");c=c||{},c._stream=b;var e=new g(a,this,c);return this._addConnection(a,e),e},c.prototype._addConnection=function(a,b){this.connections[a]||(this.connections[a]=[]),this.connections[a].push(b)},c.prototype.getConnection=function(a,b){var c=this.connections[a];if(!c)return null;for(var d=0,e=c.length;e>d;d++)if(c[d].id===b)return c[d];return null},c.prototype._delayedAbort=function(a,b){var c=this;d.setZeroTimeout(function(){c._abort(a,b)})},c.prototype._abort=function(a,b){d.error("Aborting!"),this._lastServerId?this.disconnect():this.destroy(),this.emitError(a,b)},c.prototype.emitError=function(a,b){d.error("Error:",b),"string"==typeof b&&(b=new Error(b)),b.type=a,this.emit("error",b)},c.prototype.destroy=function(){this.destroyed||(this._cleanup(),this.disconnect(),this.destroyed=!0)},c.prototype._cleanup=function(){if(this.connections)for(var a=Object.keys(this.connections),b=0,c=a.length;c>b;b++)this._cleanupPeer(a[b]);this.emit("close")},c.prototype._cleanupPeer=function(a){for(var b=this.connections[a],c=0,d=b.length;d>c;c+=1)b[c].close()},c.prototype.disconnect=function(){var a=this;d.setZeroTimeout(function(){a.disconnected||(a.disconnected=!0,a.open=!1,a.socket&&a.socket.close(),a.emit("disconnected",a.id),a._lastServerId=a.id,a.id=null)})},c.prototype.reconnect=function(){if(this.disconnected&&!this.destroyed)d.log("Attempting reconnection to server with ID "+this._lastServerId),this.disconnected=!1,this._initializeServerConnection(),this._initialize(this._lastServerId);else{if(this.destroyed)throw new Error("This peer cannot reconnect to the server. It has already been destroyed.");if(this.disconnected||this.open)throw new Error("Peer "+this.id+" cannot reconnect because it is not disconnected from the server!");d.error("In a hurry? We're still trying to make the initial connection!")}},c.prototype.listAllPeers=function(a){a=a||function(){};var b=this,c=new XMLHttpRequest,e=this.options.secure?"https://":"http://",f=e+this.options.host+":"+this.options.port+this.options.path+this.options.key+"/peers",g="?ts="+(new Date).getTime()+Math.random();f+=g,c.open("get",f,!0),c.onerror=function(){b._abort("server-error","Could not get peers from the server."),a([])},c.onreadystatechange=function(){if(4===c.readyState){if(401===c.status){var e="";throw e=b.options.host!==d.CLOUD_HOST?"It looks like you're using the cloud server. You can email team@peerjs.com to enable peer listing for your API key.":"You need to enable `allow_discovery` on your self-hosted PeerServer to use this feature.",a([]),new Error("It doesn't look like you have permission to list peers IDs. "+e)}a(200!==c.status?[]:JSON.parse(c.responseText))}},c.send(null)},b.exports=c},{"./dataconnection":2,"./mediaconnection":4,"./socket":7,"./util":8,eventemitter3:9}],7:[function(a,b){function c(a,b,d,f,g){if(!(this instanceof c))return new c(a,b,d,f,g);e.call(this),this.disconnected=!1,this._queue=[];var h=a?"https://":"http://",i=a?"wss://":"ws://";this._httpUrl=h+b+":"+d+f+g,this._wsUrl=i+b+":"+d+f+"peerjs?key="+g}var d=a("./util"),e=a("eventemitter3");d.inherits(c,e),c.prototype.start=function(a,b){this.id=a,this._httpUrl+="/"+a+"/"+b,this._wsUrl+="&id="+a+"&token="+b,this._startXhrStream(),this._startWebSocket()},c.prototype._startWebSocket=function(){var a=this;this._socket||(this._socket=new WebSocket(this._wsUrl),this._socket.onmessage=function(b){try{var c=JSON.parse(b.data)}catch(e){return void d.log("Invalid server message",b.data)}a.emit("message",c)},this._socket.onclose=function(){d.log("Socket closed."),a.disconnected=!0,a.emit("disconnected")},this._socket.onopen=function(){a._timeout&&(clearTimeout(a._timeout),setTimeout(function(){a._http.abort(),a._http=null},5e3)),a._sendQueuedMessages(),d.log("Socket open")})},c.prototype._startXhrStream=function(a){try{var b=this;this._http=new XMLHttpRequest,this._http._index=1,this._http._streamIndex=a||0,this._http.open("post",this._httpUrl+"/id?i="+this._http._streamIndex,!0),this._http.onerror=function(){clearTimeout(b._timeout),b.emit("disconnected")},this._http.onreadystatechange=function(){2==this.readyState&&this.old?(this.old.abort(),delete this.old):this.readyState>2&&200===this.status&&this.responseText&&b._handleStream(this)},this._http.send(null),this._setHTTPTimeout()}catch(c){d.log("XMLHttpRequest not available; defaulting to WebSockets")}},c.prototype._handleStream=function(a){var b=a.responseText.split("\n");if(a._buffer)for(;a._buffer.length>0;){var c=a._buffer.shift(),e=b[c];try{e=JSON.parse(e)}catch(f){a._buffer.shift(c);break}this.emit("message",e)}var g=b[a._index];if(g)if(a._index+=1,a._index===b.length)a._buffer||(a._buffer=[]),a._buffer.push(a._index-1);else{try{g=JSON.parse(g)}catch(f){return void d.log("Invalid server message",g)}this.emit("message",g)}},c.prototype._setHTTPTimeout=function(){var a=this;this._timeout=setTimeout(function(){var b=a._http;a._wsOpen()?b.abort():(a._startXhrStream(b._streamIndex+1),a._http.old=b)},25e3)},c.prototype._wsOpen=function(){return this._socket&&1==this._socket.readyState},c.prototype._sendQueuedMessages=function(){for(var a=0,b=this._queue.length;b>a;a+=1)this.send(this._queue[a])},c.prototype.send=function(a){if(!this.disconnected){if(!this.id)return void this._queue.push(a);if(!a.type)return void this.emit("error","Invalid message");var b=JSON.stringify(a);if(this._wsOpen())this._socket.send(b);else{var c=new XMLHttpRequest,d=this._httpUrl+"/"+a.type.toLowerCase();c.open("post",d,!0),c.setRequestHeader("Content-Type","application/json"),c.send(b)}}},c.prototype.close=function(){!this.disconnected&&this._wsOpen()&&(this._socket.close(),this.disconnected=!0)},b.exports=c},{"./util":8,eventemitter3:9}],8:[function(a,b){var c={iceServers:[{url:"stun:stun.l.google.com:19302"}]},d=1,e=a("js-binarypack"),f=a("./adapter").RTCPeerConnection,g={noop:function(){},CLOUD_HOST:"0.peerjs.com",CLOUD_PORT:9e3,chunkedBrowsers:{Chrome:1},chunkedMTU:16300,logLevel:0,setLogLevel:function(a){var b=parseInt(a,10);g.logLevel=isNaN(parseInt(a,10))?a?3:0:b,g.log=g.warn=g.error=g.noop,g.logLevel>0&&(g.error=g._printWith("ERROR")),g.logLevel>1&&(g.warn=g._printWith("WARNING")),g.logLevel>2&&(g.log=g._print)},setLogFunction:function(a){a.constructor!==Function?g.warn("The log function you passed in is not a function. Defaulting to regular logs."):g._print=a},_printWith:function(a){return function(){var b=Array.prototype.slice.call(arguments);b.unshift(a),g._print.apply(g,b)}},_print:function(){var a=!1,b=Array.prototype.slice.call(arguments);b.unshift("PeerJS: ");for(var c=0,d=b.length;d>c;c++)b[c]instanceof Error&&(b[c]="("+b[c].name+") "+b[c].message,a=!0);a?console.error.apply(console,b):console.log.apply(console,b)},defaultConfig:c,browser:function(){return window.mozRTCPeerConnection?"Firefox":window.webkitRTCPeerConnection?"Chrome":window.RTCPeerConnection?"Supported":"Unsupported"}(),supports:function(){if("undefined"==typeof f)return{};var a,b,d=!0,e=!0,h=!1,i=!1,j=!!window.webkitRTCPeerConnection;try{a=new f(c,{optional:[{RtpDataChannels:!0}]})}catch(k){d=!1,e=!1}if(d)try{b=a.createDataChannel("_PEERJSTEST")}catch(k){d=!1}if(d){try{b.binaryType="blob",h=!0}catch(k){}var l=new f(c,{});try{var m=l.createDataChannel("_PEERJSRELIABLETEST",{});i=m.reliable}catch(k){}l.close()}if(e&&(e=!!a.addStream),!j&&d){var n=new f(c,{optional:[{RtpDataChannels:!0}]});n.onnegotiationneeded=function(){j=!0,g&&g.supports&&(g.supports.onnegotiationneeded=!0)},n.createDataChannel("_PEERJSNEGOTIATIONTEST"),setTimeout(function(){n.close()},1e3)}return a&&a.close(),{audioVideo:e,data:d,binaryBlob:h,binary:i,reliable:i,sctp:i,onnegotiationneeded:j}}(),validateId:function(a){return!a||/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.exec(a)},validateKey:function(a){return!a||/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.exec(a)},debug:!1,inherits:function(a,b){a.super_=b,a.prototype=Object.create(b.prototype,{constructor:{value:a,enumerable:!1,writable:!0,configurable:!0}})},extend:function(a,b){for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a},pack:e.pack,unpack:e.unpack,log:function(){if(g.debug){var a=!1,b=Array.prototype.slice.call(arguments);b.unshift("PeerJS: ");for(var c=0,d=b.length;d>c;c++)b[c]instanceof Error&&(b[c]="("+b[c].name+") "+b[c].message,a=!0);a?console.error.apply(console,b):console.log.apply(console,b)}},setZeroTimeout:function(a){function b(b){d.push(b),a.postMessage(e,"*")}function c(b){b.source==a&&b.data==e&&(b.stopPropagation&&b.stopPropagation(),d.length&&d.shift()())}var d=[],e="zero-timeout-message";return a.addEventListener?a.addEventListener("message",c,!0):a.attachEvent&&a.attachEvent("onmessage",c),b}(window),chunk:function(a){for(var b=[],c=a.size,e=index=0,f=Math.ceil(c/g.chunkedMTU);c>e;){var h=Math.min(c,e+g.chunkedMTU),i=a.slice(e,h),j={__peerData:d,n:index,data:i,total:f};b.push(j),e=h,index+=1}return d+=1,b},blobToArrayBuffer:function(a,b){var c=new FileReader;c.onload=function(a){b(a.target.result)},c.readAsArrayBuffer(a)},blobToBinaryString:function(a,b){var c=new FileReader;c.onload=function(a){b(a.target.result)},c.readAsBinaryString(a)},binaryStringToArrayBuffer:function(a){for(var b=new Uint8Array(a.length),c=0;c<a.length;c++)b[c]=255&a.charCodeAt(c);return b.buffer},randomToken:function(){return Math.random().toString(36).substr(2)},isSecure:function(){return"https:"===location.protocol}};b.exports=g},{"./adapter":1,"js-binarypack":10}],9:[function(a,b){"use strict";function c(a,b,c){this.fn=a,this.context=b,this.once=c||!1}function d(){}d.prototype._events=void 0,d.prototype.listeners=function(a){if(!this._events||!this._events[a])return[];for(var b=0,c=this._events[a].length,d=[];c>b;b++)d.push(this._events[a][b].fn);return d},d.prototype.emit=function(a,b,c,d,e,f){if(!this._events||!this._events[a])return!1;var g,h,i,j=this._events[a],k=j.length,l=arguments.length,m=j[0];if(1===k){switch(m.once&&this.removeListener(a,m.fn,!0),l){case 1:return m.fn.call(m.context),!0;case 2:return m.fn.call(m.context,b),!0;case 3:return m.fn.call(m.context,b,c),!0;case 4:return m.fn.call(m.context,b,c,d),!0;case 5:return m.fn.call(m.context,b,c,d,e),!0;case 6:return m.fn.call(m.context,b,c,d,e,f),!0}for(h=1,g=new Array(l-1);l>h;h++)g[h-1]=arguments[h];m.fn.apply(m.context,g)}else for(h=0;k>h;h++)switch(j[h].once&&this.removeListener(a,j[h].fn,!0),l){case 1:j[h].fn.call(j[h].context);break;case 2:j[h].fn.call(j[h].context,b);break;case 3:j[h].fn.call(j[h].context,b,c);break;default:if(!g)for(i=1,g=new Array(l-1);l>i;i++)g[i-1]=arguments[i];j[h].fn.apply(j[h].context,g)}return!0},d.prototype.on=function(a,b,d){return this._events||(this._events={}),this._events[a]||(this._events[a]=[]),this._events[a].push(new c(b,d||this)),this},d.prototype.once=function(a,b,d){return this._events||(this._events={}),this._events[a]||(this._events[a]=[]),this._events[a].push(new c(b,d||this,!0)),this},d.prototype.removeListener=function(a,b,c){if(!this._events||!this._events[a])return this;var d=this._events[a],e=[];if(b)for(var f=0,g=d.length;g>f;f++)d[f].fn!==b&&d[f].once!==c&&e.push(d[f]);return this._events[a]=e.length?e:null,this},d.prototype.removeAllListeners=function(a){return this._events?(a?this._events[a]=null:this._events={},this):this},d.prototype.off=d.prototype.removeListener,d.prototype.addListener=d.prototype.on,d.prototype.setMaxListeners=function(){return this},d.EventEmitter=d,d.EventEmitter2=d,d.EventEmitter3=d,"object"==typeof b&&b.exports&&(b.exports=d)},{}],10:[function(a,b){function c(a){this.index=0,this.dataBuffer=a,this.dataView=new Uint8Array(this.dataBuffer),this.length=this.dataBuffer.byteLength}function d(){this.bufferBuilder=new g}function e(a){var b=a.charCodeAt(0);return 2047>=b?"00":65535>=b?"000":2097151>=b?"0000":67108863>=b?"00000":"000000"}function f(a){return a.length>600?new Blob([a]).size:a.replace(/[^\u0000-\u007F]/g,e).length}var g=a("./bufferbuilder").BufferBuilder,h=a("./bufferbuilder").binaryFeatures,i={unpack:function(a){var b=new c(a);return b.unpack()},pack:function(a){var b=new d;b.pack(a);var c=b.getBuffer();return c}};b.exports=i,c.prototype.unpack=function(){var a=this.unpack_uint8();if(128>a){var b=a;return b}if(32>(224^a)){var c=(224^a)-32;return c}var d;if((d=160^a)<=15)return this.unpack_raw(d);if((d=176^a)<=15)return this.unpack_string(d);if((d=144^a)<=15)return this.unpack_array(d);if((d=128^a)<=15)return this.unpack_map(d);switch(a){case 192:return null;case 193:return void 0;case 194:return!1;case 195:return!0;case 202:return this.unpack_float();case 203:return this.unpack_double();case 204:return this.unpack_uint8();case 205:return this.unpack_uint16();case 206:return this.unpack_uint32();case 207:return this.unpack_uint64();case 208:return this.unpack_int8();case 209:return this.unpack_int16();case 210:return this.unpack_int32();case 211:return this.unpack_int64();case 212:return void 0;case 213:return void 0;case 214:return void 0;case 215:return void 0;case 216:return d=this.unpack_uint16(),this.unpack_string(d);case 217:return d=this.unpack_uint32(),this.unpack_string(d);case 218:return d=this.unpack_uint16(),this.unpack_raw(d);case 219:return d=this.unpack_uint32(),this.unpack_raw(d);case 220:return d=this.unpack_uint16(),this.unpack_array(d);case 221:return d=this.unpack_uint32(),this.unpack_array(d);case 222:return d=this.unpack_uint16(),this.unpack_map(d);case 223:return d=this.unpack_uint32(),this.unpack_map(d)}},c.prototype.unpack_uint8=function(){var a=255&this.dataView[this.index];return this.index++,a},c.prototype.unpack_uint16=function(){var a=this.read(2),b=256*(255&a[0])+(255&a[1]);return this.index+=2,b},c.prototype.unpack_uint32=function(){var a=this.read(4),b=256*(256*(256*a[0]+a[1])+a[2])+a[3];return this.index+=4,b},c.prototype.unpack_uint64=function(){var a=this.read(8),b=256*(256*(256*(256*(256*(256*(256*a[0]+a[1])+a[2])+a[3])+a[4])+a[5])+a[6])+a[7];return this.index+=8,b},c.prototype.unpack_int8=function(){var a=this.unpack_uint8();return 128>a?a:a-256},c.prototype.unpack_int16=function(){var a=this.unpack_uint16();return 32768>a?a:a-65536},c.prototype.unpack_int32=function(){var a=this.unpack_uint32();return a<Math.pow(2,31)?a:a-Math.pow(2,32)},c.prototype.unpack_int64=function(){var a=this.unpack_uint64();return a<Math.pow(2,63)?a:a-Math.pow(2,64)},c.prototype.unpack_raw=function(a){if(this.length<this.index+a)throw new Error("BinaryPackFailure: index is out of range "+this.index+" "+a+" "+this.length);var b=this.dataBuffer.slice(this.index,this.index+a);return this.index+=a,b},c.prototype.unpack_string=function(a){for(var b,c,d=this.read(a),e=0,f="";a>e;)b=d[e],128>b?(f+=String.fromCharCode(b),e++):32>(192^b)?(c=(192^b)<<6|63&d[e+1],f+=String.fromCharCode(c),e+=2):(c=(15&b)<<12|(63&d[e+1])<<6|63&d[e+2],f+=String.fromCharCode(c),e+=3);return this.index+=a,f},c.prototype.unpack_array=function(a){for(var b=new Array(a),c=0;a>c;c++)b[c]=this.unpack();return b},c.prototype.unpack_map=function(a){for(var b={},c=0;a>c;c++){var d=this.unpack(),e=this.unpack();b[d]=e}return b},c.prototype.unpack_float=function(){var a=this.unpack_uint32(),b=a>>31,c=(a>>23&255)-127,d=8388607&a|8388608;return(0==b?1:-1)*d*Math.pow(2,c-23)},c.prototype.unpack_double=function(){var a=this.unpack_uint32(),b=this.unpack_uint32(),c=a>>31,d=(a>>20&2047)-1023,e=1048575&a|1048576,f=e*Math.pow(2,d-20)+b*Math.pow(2,d-52);return(0==c?1:-1)*f},c.prototype.read=function(a){var b=this.index;if(b+a<=this.length)return this.dataView.subarray(b,b+a);throw new Error("BinaryPackFailure: read index out of range")},d.prototype.getBuffer=function(){return this.bufferBuilder.getBuffer()},d.prototype.pack=function(a){var b=typeof a;if("string"==b)this.pack_string(a);else if("number"==b)Math.floor(a)===a?this.pack_integer(a):this.pack_double(a);else if("boolean"==b)a===!0?this.bufferBuilder.append(195):a===!1&&this.bufferBuilder.append(194);else if("undefined"==b)this.bufferBuilder.append(192);else{if("object"!=b)throw new Error('Type "'+b+'" not yet supported');if(null===a)this.bufferBuilder.append(192);else{var c=a.constructor;if(c==Array)this.pack_array(a);else if(c==Blob||c==File)this.pack_bin(a);
  else if(c==ArrayBuffer)this.pack_bin(h.useArrayBufferView?new Uint8Array(a):a);else if("BYTES_PER_ELEMENT"in a)this.pack_bin(h.useArrayBufferView?new Uint8Array(a.buffer):a.buffer);else if(c==Object)this.pack_object(a);else if(c==Date)this.pack_string(a.toString());else{if("function"!=typeof a.toBinaryPack)throw new Error('Type "'+c.toString()+'" not yet supported');this.bufferBuilder.append(a.toBinaryPack())}}}this.bufferBuilder.flush()},d.prototype.pack_bin=function(a){var b=a.length||a.byteLength||a.size;if(15>=b)this.pack_uint8(160+b);else if(65535>=b)this.bufferBuilder.append(218),this.pack_uint16(b);else{if(!(4294967295>=b))throw new Error("Invalid length");this.bufferBuilder.append(219),this.pack_uint32(b)}this.bufferBuilder.append(a)},d.prototype.pack_string=function(a){var b=f(a);if(15>=b)this.pack_uint8(176+b);else if(65535>=b)this.bufferBuilder.append(216),this.pack_uint16(b);else{if(!(4294967295>=b))throw new Error("Invalid length");this.bufferBuilder.append(217),this.pack_uint32(b)}this.bufferBuilder.append(a)},d.prototype.pack_array=function(a){var b=a.length;if(15>=b)this.pack_uint8(144+b);else if(65535>=b)this.bufferBuilder.append(220),this.pack_uint16(b);else{if(!(4294967295>=b))throw new Error("Invalid length");this.bufferBuilder.append(221),this.pack_uint32(b)}for(var c=0;b>c;c++)this.pack(a[c])},d.prototype.pack_integer=function(a){if(a>=-32&&127>=a)this.bufferBuilder.append(255&a);else if(a>=0&&255>=a)this.bufferBuilder.append(204),this.pack_uint8(a);else if(a>=-128&&127>=a)this.bufferBuilder.append(208),this.pack_int8(a);else if(a>=0&&65535>=a)this.bufferBuilder.append(205),this.pack_uint16(a);else if(a>=-32768&&32767>=a)this.bufferBuilder.append(209),this.pack_int16(a);else if(a>=0&&4294967295>=a)this.bufferBuilder.append(206),this.pack_uint32(a);else if(a>=-2147483648&&2147483647>=a)this.bufferBuilder.append(210),this.pack_int32(a);else if(a>=-0x8000000000000000&&0x8000000000000000>=a)this.bufferBuilder.append(211),this.pack_int64(a);else{if(!(a>=0&&0x10000000000000000>=a))throw new Error("Invalid integer");this.bufferBuilder.append(207),this.pack_uint64(a)}},d.prototype.pack_double=function(a){var b=0;0>a&&(b=1,a=-a);var c=Math.floor(Math.log(a)/Math.LN2),d=a/Math.pow(2,c)-1,e=Math.floor(d*Math.pow(2,52)),f=Math.pow(2,32),g=b<<31|c+1023<<20|e/f&1048575,h=e%f;this.bufferBuilder.append(203),this.pack_int32(g),this.pack_int32(h)},d.prototype.pack_object=function(a){var b=Object.keys(a),c=b.length;if(15>=c)this.pack_uint8(128+c);else if(65535>=c)this.bufferBuilder.append(222),this.pack_uint16(c);else{if(!(4294967295>=c))throw new Error("Invalid length");this.bufferBuilder.append(223),this.pack_uint32(c)}for(var d in a)a.hasOwnProperty(d)&&(this.pack(d),this.pack(a[d]))},d.prototype.pack_uint8=function(a){this.bufferBuilder.append(a)},d.prototype.pack_uint16=function(a){this.bufferBuilder.append(a>>8),this.bufferBuilder.append(255&a)},d.prototype.pack_uint32=function(a){var b=4294967295&a;this.bufferBuilder.append((4278190080&b)>>>24),this.bufferBuilder.append((16711680&b)>>>16),this.bufferBuilder.append((65280&b)>>>8),this.bufferBuilder.append(255&b)},d.prototype.pack_uint64=function(a){var b=a/Math.pow(2,32),c=a%Math.pow(2,32);this.bufferBuilder.append((4278190080&b)>>>24),this.bufferBuilder.append((16711680&b)>>>16),this.bufferBuilder.append((65280&b)>>>8),this.bufferBuilder.append(255&b),this.bufferBuilder.append((4278190080&c)>>>24),this.bufferBuilder.append((16711680&c)>>>16),this.bufferBuilder.append((65280&c)>>>8),this.bufferBuilder.append(255&c)},d.prototype.pack_int8=function(a){this.bufferBuilder.append(255&a)},d.prototype.pack_int16=function(a){this.bufferBuilder.append((65280&a)>>8),this.bufferBuilder.append(255&a)},d.prototype.pack_int32=function(a){this.bufferBuilder.append(a>>>24&255),this.bufferBuilder.append((16711680&a)>>>16),this.bufferBuilder.append((65280&a)>>>8),this.bufferBuilder.append(255&a)},d.prototype.pack_int64=function(a){var b=Math.floor(a/Math.pow(2,32)),c=a%Math.pow(2,32);this.bufferBuilder.append((4278190080&b)>>>24),this.bufferBuilder.append((16711680&b)>>>16),this.bufferBuilder.append((65280&b)>>>8),this.bufferBuilder.append(255&b),this.bufferBuilder.append((4278190080&c)>>>24),this.bufferBuilder.append((16711680&c)>>>16),this.bufferBuilder.append((65280&c)>>>8),this.bufferBuilder.append(255&c)}},{"./bufferbuilder":11}],11:[function(a,b){function c(){this._pieces=[],this._parts=[]}var d={};d.useBlobBuilder=function(){try{return new Blob([]),!1}catch(a){return!0}}(),d.useArrayBufferView=!d.useBlobBuilder&&function(){try{return 0===new Blob([new Uint8Array([])]).size}catch(a){return!0}}(),b.exports.binaryFeatures=d;var e=b.exports.BlobBuilder;"undefined"!=typeof window&&(e=b.exports.BlobBuilder=window.WebKitBlobBuilder||window.MozBlobBuilder||window.MSBlobBuilder||window.BlobBuilder),c.prototype.append=function(a){"number"==typeof a?this._pieces.push(a):(this.flush(),this._parts.push(a))},c.prototype.flush=function(){if(this._pieces.length>0){var a=new Uint8Array(this._pieces);d.useArrayBufferView||(a=a.buffer),this._parts.push(a),this._pieces=[]}},c.prototype.getBuffer=function(){if(this.flush(),d.useBlobBuilder){for(var a=new e,b=0,c=this._parts.length;c>b;b++)a.append(this._parts[b]);return a.getBlob()}return new Blob(this._parts)},b.exports.BufferBuilder=c},{}],12:[function(a,b){function c(a,b){return this instanceof c?(this._dc=a,d.debug=b,this._outgoing={},this._incoming={},this._received={},this._window=1e3,this._mtu=500,this._interval=0,this._count=0,this._queue=[],void this._setupDC()):new c(a)}var d=a("./util");c.prototype.send=function(a){var b=d.pack(a);return b.size<this._mtu?void this._handleSend(["no",b]):(this._outgoing[this._count]={ack:0,chunks:this._chunk(b)},d.debug&&(this._outgoing[this._count].timer=new Date),this._sendWindowedChunks(this._count),void(this._count+=1))},c.prototype._setupInterval=function(){var a=this;this._timeout=setInterval(function(){var b=a._queue.shift();if(b._multiple)for(var c=0,d=b.length;d>c;c+=1)a._intervalSend(b[c]);else a._intervalSend(b)},this._interval)},c.prototype._intervalSend=function(a){var b=this;a=d.pack(a),d.blobToBinaryString(a,function(a){b._dc.send(a)}),0===b._queue.length&&(clearTimeout(b._timeout),b._timeout=null)},c.prototype._processAcks=function(){for(var a in this._outgoing)this._outgoing.hasOwnProperty(a)&&this._sendWindowedChunks(a)},c.prototype._handleSend=function(a){for(var b=!0,c=0,d=this._queue.length;d>c;c+=1){var e=this._queue[c];e===a?b=!1:e._multiple&&-1!==e.indexOf(a)&&(b=!1)}b&&(this._queue.push(a),this._timeout||this._setupInterval())},c.prototype._setupDC=function(){var a=this;this._dc.onmessage=function(b){var c=b.data,e=c.constructor;if(e===String){var f=d.binaryStringToArrayBuffer(c);c=d.unpack(f),a._handleMessage(c)}}},c.prototype._handleMessage=function(a){var b,c=a[1],e=this._incoming[c],f=this._outgoing[c];switch(a[0]){case"no":var g=c;g&&this.onmessage(d.unpack(g));break;case"end":if(b=e,this._received[c]=a[2],!b)break;this._ack(c);break;case"ack":if(b=f){var h=a[2];b.ack=Math.max(h,b.ack),b.ack>=b.chunks.length?(d.log("Time: ",new Date-b.timer),delete this._outgoing[c]):this._processAcks()}break;case"chunk":if(b=e,!b){var i=this._received[c];if(i===!0)break;b={ack:["ack",c,0],chunks:[]},this._incoming[c]=b}var j=a[2],k=a[3];b.chunks[j]=new Uint8Array(k),j===b.ack[2]&&this._calculateNextAck(c),this._ack(c);break;default:this._handleSend(a)}},c.prototype._chunk=function(a){for(var b=[],c=a.size,e=0;c>e;){var f=Math.min(c,e+this._mtu),g=a.slice(e,f),h={payload:g};b.push(h),e=f}return d.log("Created",b.length,"chunks."),b},c.prototype._ack=function(a){var b=this._incoming[a].ack;this._received[a]===b[2]&&(this._complete(a),this._received[a]=!0),this._handleSend(b)},c.prototype._calculateNextAck=function(a){for(var b=this._incoming[a],c=b.chunks,d=0,e=c.length;e>d;d+=1)if(void 0===c[d])return void(b.ack[2]=d);b.ack[2]=c.length},c.prototype._sendWindowedChunks=function(a){d.log("sendWindowedChunks for: ",a);for(var b=this._outgoing[a],c=b.chunks,e=[],f=Math.min(b.ack+this._window,c.length),g=b.ack;f>g;g+=1)c[g].sent&&g!==b.ack||(c[g].sent=!0,e.push(["chunk",a,g,c[g].payload]));b.ack+this._window>=c.length&&e.push(["end",a,c.length]),e._multiple=!0,this._handleSend(e)},c.prototype._complete=function(a){d.log("Completed called for",a);var b=this,c=this._incoming[a].chunks,e=new Blob(c);d.blobToArrayBuffer(e,function(a){b.onmessage(d.unpack(a))}),delete this._incoming[a]},c.higherBandwidthSDP=function(a){var b=navigator.appVersion.match(/Chrome\/(.*?) /);if(b&&(b=parseInt(b[1].split(".").shift()),31>b)){var c=a.split("b=AS:30"),d="b=AS:102400";if(c.length>1)return c[0]+d+c[1]}return a},c.prototype.onmessage=function(){},b.exports.Reliable=c},{"./util":13}],13:[function(a,b){var c=a("js-binarypack"),d={debug:!1,inherits:function(a,b){a.super_=b,a.prototype=Object.create(b.prototype,{constructor:{value:a,enumerable:!1,writable:!0,configurable:!0}})},extend:function(a,b){for(var c in b)b.hasOwnProperty(c)&&(a[c]=b[c]);return a},pack:c.pack,unpack:c.unpack,log:function(){if(d.debug){for(var a=[],b=0;b<arguments.length;b++)a[b]=arguments[b];a.unshift("Reliable: "),console.log.apply(console,a)}},setZeroTimeout:function(a){function b(b){d.push(b),a.postMessage(e,"*")}function c(b){b.source==a&&b.data==e&&(b.stopPropagation&&b.stopPropagation(),d.length&&d.shift()())}var d=[],e="zero-timeout-message";return a.addEventListener?a.addEventListener("message",c,!0):a.attachEvent&&a.attachEvent("onmessage",c),b}(this),blobToArrayBuffer:function(a,b){var c=new FileReader;c.onload=function(a){b(a.target.result)},c.readAsArrayBuffer(a)},blobToBinaryString:function(a,b){var c=new FileReader;c.onload=function(a){b(a.target.result)},c.readAsBinaryString(a)},binaryStringToArrayBuffer:function(a){for(var b=new Uint8Array(a.length),c=0;c<a.length;c++)b[c]=255&a.charCodeAt(c);return b.buffer},randomToken:function(){return Math.random().toString(36).substr(2)}};b.exports=d},{"js-binarypack":10}]},{},[3]);
      }

  
  var toC={string:function (str) {
          var bufferSize = lengthBytesUTF8(str) + 1; // determine memory size
          var buffer = _malloc(bufferSize); // allocate memory
          stringToUTF8(str, buffer, bufferSize); // write string to memory
          return buffer;
        }};function _InvokeCallback_v(callback) {
      dynCall_v(callback); // invoke callback
    }

  function _InvokeCallback_vi(callback_vi) {
      dynCall_vi(callback_vi, 5); // invoke callback
    }

  function _InvokeCallback_vii(callback_vii) {
      dynCall_vii(callback_vii, 5, 10); // invoke callback
    }

  function _InvokeCallback_vs(callback_vs) {
      dynCall_vi(callback_vs, toC.string("This string is allocated in JavaScript, and can be passed to C# as a System.String."));
    }

  function _Invoke_i() {
      return 5;
    }

  function _Invoke_s() {
      return toC.string("This System.String was allocated in JavaScript, and can be returned to C#");
    }

  function _Invoke_vs(message) {
      message = UTF8ToString(message); // convert C string to JavaScript string
      console.log("Received this string from C#: " + message);
    }

  function _OpenPeer(key, id, host, port) {
          
          var keystr = UTF8ToString(key);
          var idstr = UTF8ToString(id);
          var hoststr = UTF8ToString(host);
  
          var peer = {
              peer: new Peer(idstr, { key: keystr, debug: 2, host: hoststr, port: port}),
              initialized: false,
              conns: [],
              events: [],
          };
  
          var peerInstance = UnityPeerJS.peers.push(peer) - 1;
  
          peer.newConnection = function (conn) {
  
              var connInstance = peer.conns.push(conn) - 1;
  
              conn.on('open', function () {
  
                  peer.events.push({ ev: 2, conn: connInstance, id: conn.peer });
  
                  conn.on('data', function (data) {
  
                      peer.events.push({ ev: 3, conn: connInstance, data: data });
                  });
              });
  
              conn.on('close', function () {
  
                  peer.events.push({ ev: 4, conn: connInstance });
              });
          };
  
          peer.popEvent = function (eventType) {
              
              if (peer.events.length == 0) {
                  console.log("error: popEvent: event queue is empty");
                  return null;
              }
  
              if (eventType != 0 && peer.events[0].ev != eventType) {
                  console.log("error: popEvent: event type mismatch", eventType, peer.events[0].ev);
                  return null;
              }
  
              var result = peer.events.shift();
              return result;
          };
  
          peer.peer.on('open', function (id) {
  
              peer.initialized = true;
              peer.events.push({ ev: 1 });
          });
  
          peer.peer.on('connection', peer.newConnection);
          peer.peer.on('disconnected', function () { peer.events.push({ ev: 5 }) });
          peer.peer.on('close', function () { peer.events.push({ ev: 6 }) });
          peer.peer.on('error', function (err) { peer.events.push({ ev: 7, err: err.type }) });
  
          return peerInstance;
      }

  function _Send(peerInstance, connInstance, data, length) {
  
          var peer = UnityPeerJS.peers[peerInstance];
          var conn = peer.conns[connInstance];
          var datastr = UTF8ToString(data);
  
          console.log('sending data', length);
  
          conn.send(datastr);
      }

  
  var ___exception_infos={};
  
  var ___exception_caught= [];
  
  function ___exception_addRef(ptr) {
      if (!ptr) return;
      var info = ___exception_infos[ptr];
      info.refcount++;
    }
  
  function ___exception_deAdjust(adjusted) {
      if (!adjusted || ___exception_infos[adjusted]) return adjusted;
      for (var key in ___exception_infos) {
        var ptr = +key; // the iteration key is a string, and if we throw this, it must be an integer as that is what we look for
        var adj = ___exception_infos[ptr].adjusted;
        var len = adj.length;
        for (var i = 0; i < len; i++) {
          if (adj[i] === adjusted) {
            return ptr;
          }
        }
      }
      return adjusted;
    }function ___cxa_begin_catch(ptr) {
      var info = ___exception_infos[ptr];
      if (info && !info.caught) {
        info.caught = true;
        __ZSt18uncaught_exceptionv.uncaught_exception--;
      }
      if (info) info.rethrown = false;
      ___exception_caught.push(ptr);
      ___exception_addRef(___exception_deAdjust(ptr));
      return ptr;
    }

  function ___gxx_personality_v0() {
    }

  function ___lock() {}

  
  var SYSCALLS={buffers:[null,[],[]],printChar:function(stream, curr) {
        var buffer = SYSCALLS.buffers[stream];
        assert(buffer);
        if (curr === 0 || curr === 10) {
          (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
          buffer.length = 0;
        } else {
          buffer.push(curr);
        }
      },varargs:0,get:function(varargs) {
        SYSCALLS.varargs += 4;
        var ret = HEAP32[(((SYSCALLS.varargs)-(4))>>2)];
        return ret;
      },getStr:function() {
        var ret = UTF8ToString(SYSCALLS.get());
        return ret;
      },get64:function() {
        var low = SYSCALLS.get(), high = SYSCALLS.get();
        if (low >= 0) assert(high === 0);
        else assert(high === -1);
        return low;
      },getZero:function() {
        assert(SYSCALLS.get() === 0);
      }};function ___syscall140(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // llseek
      var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
      // NOTE: offset_high is unused - Emscripten's off_t is 32-bit
      var offset = offset_low;
      FS.llseek(stream, offset, whence);
      HEAP32[((result)>>2)]=stream.position;
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall145(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // readv
      var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      return SYSCALLS.doReadv(stream, iov, iovcnt);
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  
  function flush_NO_FILESYSTEM() {
      // flush anything remaining in the buffers during shutdown
      var fflush = Module["_fflush"];
      if (fflush) fflush(0);
      var buffers = SYSCALLS.buffers;
      if (buffers[1].length) SYSCALLS.printChar(1, 10);
      if (buffers[2].length) SYSCALLS.printChar(2, 10);
    }function ___syscall146(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // writev
      // hack to support printf in FILESYSTEM=0
      var stream = SYSCALLS.get(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAP32[(((iov)+(i*8))>>2)];
        var len = HEAP32[(((iov)+(i*8 + 4))>>2)];
        for (var j = 0; j < len; j++) {
          SYSCALLS.printChar(stream, HEAPU8[ptr+j]);
        }
        ret += len;
      }
      return ret;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  
  function ___setErrNo(value) {
      return 0;
    }function ___syscall221(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // fcntl64
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall4(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // write
      // hack to support printf in FILESYSTEM=0
      var stream = SYSCALLS.get(), buf = SYSCALLS.get(), count = SYSCALLS.get();
      for (var i = 0; i < count; i++) {
        SYSCALLS.printChar(stream, HEAPU8[buf+i]);
      }
      return count;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall5(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // open
      var pathname = SYSCALLS.getStr(), flags = SYSCALLS.get(), mode = SYSCALLS.get() // optional TODO
      var stream = FS.open(pathname, flags, mode);
      return stream.fd;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall54(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // ioctl
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___syscall6(which, varargs) {SYSCALLS.varargs = varargs;
  try {
   // close
      var stream = SYSCALLS.getStreamFromFD();
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS === 'undefined' || !(e instanceof FS.ErrnoError)) abort(e);
    return -e.errno;
  }
  }

  function ___unlock() {}

  function _abort() {
      // In MINIMAL_RUNTIME the module object does not exist, so its behavior to abort is to throw directly.
      throw 'abort';
    }

  function _clock() {
      if (_clock.start === undefined) _clock.start = Date.now();
      return ((Date.now() - _clock.start) * (1000000 / 1000))|0;
    }

  var _emscripten_asm_const_int=true;

  function _emscripten_get_now() { abort() }

  
  var GL={counter:1,lastError:0,buffers:[],mappedBuffers:{},programs:[],framebuffers:[],renderbuffers:[],textures:[],uniforms:[],shaders:[],vaos:[],contexts:{},currentContext:null,offscreenCanvases:{},timerQueriesEXT:[],queries:[],samplers:[],transformFeedbacks:[],syncs:[],programInfos:{},stringCache:{},stringiCache:{},unpackAlignment:4,init:function() {
        GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
        for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
          GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i+1);
        }
      },recordError:function recordError(errorCode) {
        if (!GL.lastError) {
          GL.lastError = errorCode;
        }
      },getNewId:function(table) {
        var ret = GL.counter++;
        for (var i = table.length; i < ret; i++) {
          table[i] = null;
        }
        return ret;
      },MINI_TEMP_BUFFER_SIZE:256,miniTempBuffer:null,miniTempBufferViews:[0],getSource:function(shader, count, string, length) {
        var source = '';
        for (var i = 0; i < count; ++i) {
          var len = length ? HEAP32[(((length)+(i*4))>>2)] : -1;
          source += UTF8ToString(HEAP32[(((string)+(i*4))>>2)], len < 0 ? undefined : len);
        }
        return source;
      },createContext:function(canvas, webGLContextAttributes) {
  
  
  
  
        var ctx = 
          (webGLContextAttributes.majorVersion > 1) ? canvas.getContext("webgl2", webGLContextAttributes) :
          (canvas.getContext("webgl", webGLContextAttributes) || canvas.getContext("experimental-webgl", webGLContextAttributes));
  
  
        return ctx && GL.registerContext(ctx, webGLContextAttributes);
      },registerContext:function(ctx, webGLContextAttributes) {
        var handle = _malloc(8); // Make space on the heap to store GL context attributes that need to be accessible as shared between threads.
        var context = {
          handle: handle,
          attributes: webGLContextAttributes,
          version: webGLContextAttributes.majorVersion,
          GLctx: ctx
        };
  
        // BUG: Workaround Chrome WebGL 2 issue: the first shipped versions of WebGL 2 in Chrome did not actually implement the new WebGL 2 functions.
        //      Those are supported only in Chrome 58 and newer.
        function getChromeVersion() {
          var raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./);
          return raw ? parseInt(raw[2], 10) : false;
        }
        context.supportsWebGL2EntryPoints = (context.version >= 2) && (getChromeVersion() === false || getChromeVersion() >= 58);
  
  
        // Store the created context object so that we can access the context given a canvas without having to pass the parameters again.
        if (ctx.canvas) ctx.canvas.GLctxObject = context;
        GL.contexts[handle] = context;
        if (typeof webGLContextAttributes.enableExtensionsByDefault === 'undefined' || webGLContextAttributes.enableExtensionsByDefault) {
          GL.initExtensions(context);
        }
  
  
  
  
        return handle;
      },makeContextCurrent:function(contextHandle) {
  
        GL.currentContext = GL.contexts[contextHandle]; // Active Emscripten GL layer context object.
        Module.ctx = GLctx = GL.currentContext && GL.currentContext.GLctx; // Active WebGL context object.
        return !(contextHandle && !GLctx);
      },getContext:function(contextHandle) {
        return GL.contexts[contextHandle];
      },deleteContext:function(contextHandle) {
        if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = null;
        if (typeof JSEvents === 'object') JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas); // Release all JS event handlers on the DOM element that the GL context is associated with since the context is now deleted.
        if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined; // Make sure the canvas object no longer refers to the context object so there are no GC surprises.
        _free(GL.contexts[contextHandle]);
        GL.contexts[contextHandle] = null;
      },initExtensions:function(context) {
        // If this function is called without a specific context object, init the extensions of the currently active context.
        if (!context) context = GL.currentContext;
  
        if (context.initExtensionsDone) return;
        context.initExtensionsDone = true;
  
        var GLctx = context.GLctx;
  
        // Detect the presence of a few extensions manually, this GL interop layer itself will need to know if they exist.
  
        if (context.version < 2) {
          // Extension available from Firefox 26 and Google Chrome 30
          var instancedArraysExt = GLctx.getExtension('ANGLE_instanced_arrays');
          if (instancedArraysExt) {
            GLctx['vertexAttribDivisor'] = function(index, divisor) { instancedArraysExt['vertexAttribDivisorANGLE'](index, divisor); };
            GLctx['drawArraysInstanced'] = function(mode, first, count, primcount) { instancedArraysExt['drawArraysInstancedANGLE'](mode, first, count, primcount); };
            GLctx['drawElementsInstanced'] = function(mode, count, type, indices, primcount) { instancedArraysExt['drawElementsInstancedANGLE'](mode, count, type, indices, primcount); };
          }
  
          // Extension available from Firefox 25 and WebKit
          var vaoExt = GLctx.getExtension('OES_vertex_array_object');
          if (vaoExt) {
            GLctx['createVertexArray'] = function() { return vaoExt['createVertexArrayOES'](); };
            GLctx['deleteVertexArray'] = function(vao) { vaoExt['deleteVertexArrayOES'](vao); };
            GLctx['bindVertexArray'] = function(vao) { vaoExt['bindVertexArrayOES'](vao); };
            GLctx['isVertexArray'] = function(vao) { return vaoExt['isVertexArrayOES'](vao); };
          }
  
          var drawBuffersExt = GLctx.getExtension('WEBGL_draw_buffers');
          if (drawBuffersExt) {
            GLctx['drawBuffers'] = function(n, bufs) { drawBuffersExt['drawBuffersWEBGL'](n, bufs); };
          }
        }
  
        GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query");
  
        // These are the 'safe' feature-enabling extensions that don't add any performance impact related to e.g. debugging, and
        // should be enabled by default so that client GLES2/GL code will not need to go through extra hoops to get its stuff working.
        // As new extensions are ratified at http://www.khronos.org/registry/webgl/extensions/ , feel free to add your new extensions
        // here, as long as they don't produce a performance impact for users that might not be using those extensions.
        // E.g. debugging-related extensions should probably be off by default.
        var automaticallyEnabledExtensions = [ // Khronos ratified WebGL extensions ordered by number (no debug extensions):
                                               "OES_texture_float", "OES_texture_half_float", "OES_standard_derivatives",
                                               "OES_vertex_array_object", "WEBGL_compressed_texture_s3tc", "WEBGL_depth_texture",
                                               "OES_element_index_uint", "EXT_texture_filter_anisotropic", "EXT_frag_depth",
                                               "WEBGL_draw_buffers", "ANGLE_instanced_arrays", "OES_texture_float_linear",
                                               "OES_texture_half_float_linear", "EXT_blend_minmax", "EXT_shader_texture_lod",
                                               // Community approved WebGL extensions ordered by number:
                                               "WEBGL_compressed_texture_pvrtc", "EXT_color_buffer_half_float", "WEBGL_color_buffer_float",
                                               "EXT_sRGB", "WEBGL_compressed_texture_etc1", "EXT_disjoint_timer_query",
                                               "WEBGL_compressed_texture_etc", "WEBGL_compressed_texture_astc", "EXT_color_buffer_float",
                                               "WEBGL_compressed_texture_s3tc_srgb", "EXT_disjoint_timer_query_webgl2"];
  
        function shouldEnableAutomatically(extension) {
          var ret = false;
          automaticallyEnabledExtensions.forEach(function(include) {
            if (extension.indexOf(include) != -1) {
              ret = true;
            }
          });
          return ret;
        }
  
        var exts = GLctx.getSupportedExtensions();
        if (exts && exts.length > 0) {
          GLctx.getSupportedExtensions().forEach(function(ext) {
            if (automaticallyEnabledExtensions.indexOf(ext) != -1) {
              GLctx.getExtension(ext); // Calling .getExtension enables that extension permanently, no need to store the return value to be enabled.
            }
          });
        }
      },populateUniformTable:function(program) {
        var p = GL.programs[program];
        var ptable = GL.programInfos[program] = {
          uniforms: {},
          maxUniformLength: 0, // This is eagerly computed below, since we already enumerate all uniforms anyway.
          maxAttributeLength: -1, // This is lazily computed and cached, computed when/if first asked, "-1" meaning not computed yet.
          maxUniformBlockNameLength: -1 // Lazily computed as well
        };
  
        var utable = ptable.uniforms;
        // A program's uniform table maps the string name of an uniform to an integer location of that uniform.
        // The global GL.uniforms map maps integer locations to WebGLUniformLocations.
        var numUniforms = GLctx.getProgramParameter(p, 0x8B86/*GL_ACTIVE_UNIFORMS*/);
        for (var i = 0; i < numUniforms; ++i) {
          var u = GLctx.getActiveUniform(p, i);
  
          var name = u.name;
          ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length+1);
  
          // If we are dealing with an array, e.g. vec4 foo[3], strip off the array index part to canonicalize that "foo", "foo[]",
          // and "foo[0]" will mean the same. Loop below will populate foo[1] and foo[2].
          if (name.slice(-1) == ']') {
            name = name.slice(0, name.lastIndexOf('['));
          }
  
          // Optimize memory usage slightly: If we have an array of uniforms, e.g. 'vec3 colors[3];', then
          // only store the string 'colors' in utable, and 'colors[0]', 'colors[1]' and 'colors[2]' will be parsed as 'colors'+i.
          // Note that for the GL.uniforms table, we still need to fetch the all WebGLUniformLocations for all the indices.
          var loc = GLctx.getUniformLocation(p, name);
          if (loc) {
            var id = GL.getNewId(GL.uniforms);
            utable[name] = [u.size, id];
            GL.uniforms[id] = loc;
  
            for (var j = 1; j < u.size; ++j) {
              var n = name + '['+j+']';
              loc = GLctx.getUniformLocation(p, n);
              id = GL.getNewId(GL.uniforms);
  
              GL.uniforms[id] = loc;
            }
          }
        }
      }};function _emscripten_glActiveTexture(x0) { GLctx['activeTexture'](x0) }

  function _emscripten_glAttachShader(program, shader) {
      GLctx.attachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _emscripten_glBeginQuery(target, id) {
      GLctx['beginQuery'](target, GL.queries[id]);
    }

  function _emscripten_glBeginQueryEXT(target, id) {
      GLctx.disjointTimerQueryExt['beginQueryEXT'](target, GL.timerQueriesEXT[id]);
    }

  function _emscripten_glBeginTransformFeedback(x0) { GLctx['beginTransformFeedback'](x0) }

  function _emscripten_glBindAttribLocation(program, index, name) {
      GLctx.bindAttribLocation(GL.programs[program], index, UTF8ToString(name));
    }

  function _emscripten_glBindBuffer(target, buffer) {
  
      if (target == 0x88EB /*GL_PIXEL_PACK_BUFFER*/) {
        // In WebGL 2 glReadPixels entry point, we need to use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_PACK_BUFFER_BINDING point, so must keep track whether that binding point is non-null to know what is
        // the proper API function to call.
        GLctx.currentPixelPackBufferBinding = buffer;
      } else if (target == 0x88EC /*GL_PIXEL_UNPACK_BUFFER*/) {
        // In WebGL 2 gl(Compressed)Tex(Sub)Image[23]D entry points, we need to
        // use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_UNPACK_BUFFER_BINDING point, so must keep track whether that
        // binding point is non-null to know what is the proper API function to
        // call.
        GLctx.currentPixelUnpackBufferBinding = buffer;
      }
      GLctx.bindBuffer(target, GL.buffers[buffer]);
    }

  function _emscripten_glBindBufferBase(target, index, buffer) {
      GLctx['bindBufferBase'](target, index, GL.buffers[buffer]);
    }

  function _emscripten_glBindBufferRange(target, index, buffer, offset, ptrsize) {
      GLctx['bindBufferRange'](target, index, GL.buffers[buffer], offset, ptrsize);
    }

  function _emscripten_glBindFramebuffer(target, framebuffer) {
  
      GLctx.bindFramebuffer(target, GL.framebuffers[framebuffer]);
  
    }

  function _emscripten_glBindRenderbuffer(target, renderbuffer) {
      GLctx.bindRenderbuffer(target, GL.renderbuffers[renderbuffer]);
    }

  function _emscripten_glBindSampler(unit, sampler) {
      GLctx['bindSampler'](unit, GL.samplers[sampler]);
    }

  function _emscripten_glBindTexture(target, texture) {
      GLctx.bindTexture(target, GL.textures[texture]);
    }

  function _emscripten_glBindTransformFeedback(target, id) {
      GLctx['bindTransformFeedback'](target, GL.transformFeedbacks[id]);
    }

  function _emscripten_glBindVertexArray(vao) {
      GLctx['bindVertexArray'](GL.vaos[vao]);
    }

  function _emscripten_glBindVertexArrayOES(vao) {
      GLctx['bindVertexArray'](GL.vaos[vao]);
    }

  function _emscripten_glBlendColor(x0, x1, x2, x3) { GLctx['blendColor'](x0, x1, x2, x3) }

  function _emscripten_glBlendEquation(x0) { GLctx['blendEquation'](x0) }

  function _emscripten_glBlendEquationSeparate(x0, x1) { GLctx['blendEquationSeparate'](x0, x1) }

  function _emscripten_glBlendFunc(x0, x1) { GLctx['blendFunc'](x0, x1) }

  function _emscripten_glBlendFuncSeparate(x0, x1, x2, x3) { GLctx['blendFuncSeparate'](x0, x1, x2, x3) }

  function _emscripten_glBlitFramebuffer(x0, x1, x2, x3, x4, x5, x6, x7, x8, x9) { GLctx['blitFramebuffer'](x0, x1, x2, x3, x4, x5, x6, x7, x8, x9) }

  function _emscripten_glBufferData(target, size, data, usage) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (data) {
          GLctx.bufferData(target, HEAPU8, usage, data, size);
        } else {
          GLctx.bufferData(target, size, usage);
        }
      } else {
        // N.b. here first form specifies a heap subarray, second form an integer size, so the ?: code here is polymorphic. It is advised to avoid
        // randomly mixing both uses in calling code, to avoid any potential JS engine JIT issues.
        GLctx.bufferData(target, data ? HEAPU8.subarray(data, data+size) : size, usage);
      }
    }

  function _emscripten_glBufferSubData(target, offset, size, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.bufferSubData(target, offset, HEAPU8, data, size);
        return;
      }
      GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data+size));
    }

  function _emscripten_glCheckFramebufferStatus(x0) { return GLctx['checkFramebufferStatus'](x0) }

  function _emscripten_glClear(x0) { GLctx['clear'](x0) }

  function _emscripten_glClearBufferfi(x0, x1, x2, x3) { GLctx['clearBufferfi'](x0, x1, x2, x3) }

  function _emscripten_glClearBufferfv(buffer, drawbuffer, value) {
  
      GLctx['clearBufferfv'](buffer, drawbuffer, HEAPF32, value>>2);
    }

  function _emscripten_glClearBufferiv(buffer, drawbuffer, value) {
  
      GLctx['clearBufferiv'](buffer, drawbuffer, HEAP32, value>>2);
    }

  function _emscripten_glClearBufferuiv(buffer, drawbuffer, value) {
  
      GLctx['clearBufferuiv'](buffer, drawbuffer, HEAPU32, value>>2);
    }

  function _emscripten_glClearColor(x0, x1, x2, x3) { GLctx['clearColor'](x0, x1, x2, x3) }

  function _emscripten_glClearDepthf(x0) { GLctx['clearDepth'](x0) }

  function _emscripten_glClearStencil(x0) { GLctx['clearStencil'](x0) }

  function _emscripten_glClientWaitSync(sync, flags, timeoutLo, timeoutHi) {
      // WebGL2 vs GLES3 differences: in GLES3, the timeout parameter is a uint64, where 0xFFFFFFFFFFFFFFFFULL means GL_TIMEOUT_IGNORED.
      // In JS, there's no 64-bit value types, so instead timeout is taken to be signed, and GL_TIMEOUT_IGNORED is given value -1.
      // Inherently the value accepted in the timeout is lossy, and can't take in arbitrary u64 bit pattern (but most likely doesn't matter)
      // See https://www.khronos.org/registry/webgl/specs/latest/2.0/#5.15
      timeoutLo = timeoutLo >>> 0;
      timeoutHi = timeoutHi >>> 0;
      var timeout = (timeoutLo == 0xFFFFFFFF && timeoutHi == 0xFFFFFFFF) ? -1 : makeBigInt(timeoutLo, timeoutHi, true);
      return GLctx.clientWaitSync(GL.syncs[sync], flags, timeout);
    }

  function _emscripten_glColorMask(red, green, blue, alpha) {
      GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
    }

  function _emscripten_glCompileShader(shader) {
      GLctx.compileShader(GL.shaders[shader]);
    }

  function _emscripten_glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, imageSize, data);
        } else {
          GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, HEAPU8, data, imageSize);
        }
        return;
      }
      GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _emscripten_glCompressedTexImage3D(target, level, internalFormat, width, height, depth, border, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexImage3D'](target, level, internalFormat, width, height, depth, border, imageSize, data);
        } else {
          GLctx['compressedTexImage3D'](target, level, internalFormat, width, height, depth, border, HEAPU8, data, imageSize);
        }
      } else {
        GLctx['compressedTexImage3D'](target, level, internalFormat, width, height, depth, border, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
      }
    }

  function _emscripten_glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, imageSize, data);
        } else {
          GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, HEAPU8, data, imageSize);
        }
        return;
      }
      GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _emscripten_glCompressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, imageSize, data);
        } else {
          GLctx['compressedTexSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, HEAPU8, data, imageSize);
        }
      } else {
        GLctx['compressedTexSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
      }
    }

  function _emscripten_glCopyBufferSubData(x0, x1, x2, x3, x4) { GLctx['copyBufferSubData'](x0, x1, x2, x3, x4) }

  function _emscripten_glCopyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7) { GLctx['copyTexImage2D'](x0, x1, x2, x3, x4, x5, x6, x7) }

  function _emscripten_glCopyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7) { GLctx['copyTexSubImage2D'](x0, x1, x2, x3, x4, x5, x6, x7) }

  function _emscripten_glCopyTexSubImage3D(x0, x1, x2, x3, x4, x5, x6, x7, x8) { GLctx['copyTexSubImage3D'](x0, x1, x2, x3, x4, x5, x6, x7, x8) }

  function _emscripten_glCreateProgram() {
      var id = GL.getNewId(GL.programs);
      var program = GLctx.createProgram();
      program.name = id;
      GL.programs[id] = program;
      return id;
    }

  function _emscripten_glCreateShader(shaderType) {
      var id = GL.getNewId(GL.shaders);
      GL.shaders[id] = GLctx.createShader(shaderType);
      return id;
    }

  function _emscripten_glCullFace(x0) { GLctx['cullFace'](x0) }

  function _emscripten_glDeleteBuffers(n, buffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((buffers)+(i*4))>>2)];
        var buffer = GL.buffers[id];
  
        // From spec: "glDeleteBuffers silently ignores 0's and names that do not
        // correspond to existing buffer objects."
        if (!buffer) continue;
  
        GLctx.deleteBuffer(buffer);
        buffer.name = 0;
        GL.buffers[id] = null;
  
        if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
        if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
        if (id == GLctx.currentPixelPackBufferBinding) GLctx.currentPixelPackBufferBinding = 0;
        if (id == GLctx.currentPixelUnpackBufferBinding) GLctx.currentPixelUnpackBufferBinding = 0;
      }
    }

  function _emscripten_glDeleteFramebuffers(n, framebuffers) {
      for (var i = 0; i < n; ++i) {
        var id = HEAP32[(((framebuffers)+(i*4))>>2)];
        var framebuffer = GL.framebuffers[id];
        if (!framebuffer) continue; // GL spec: "glDeleteFramebuffers silently ignores 0s and names that do not correspond to existing framebuffer objects".
        GLctx.deleteFramebuffer(framebuffer);
        framebuffer.name = 0;
        GL.framebuffers[id] = null;
      }
    }

  function _emscripten_glDeleteProgram(id) {
      if (!id) return;
      var program = GL.programs[id];
      if (!program) { // glDeleteProgram actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteProgram(program);
      program.name = 0;
      GL.programs[id] = null;
      GL.programInfos[id] = null;
    }

  function _emscripten_glDeleteQueries(n, ids) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((ids)+(i*4))>>2)];
        var query = GL.queries[id];
        if (!query) continue; // GL spec: "unused names in ids are ignored, as is the name zero."
        GLctx['deleteQuery'](query);
        GL.queries[id] = null;
      }
    }

  function _emscripten_glDeleteQueriesEXT(n, ids) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((ids)+(i*4))>>2)];
        var query = GL.timerQueriesEXT[id];
        if (!query) continue; // GL spec: "unused names in ids are ignored, as is the name zero."
        GLctx.disjointTimerQueryExt['deleteQueryEXT'](query);
        GL.timerQueriesEXT[id] = null;
      }
    }

  function _emscripten_glDeleteRenderbuffers(n, renderbuffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((renderbuffers)+(i*4))>>2)];
        var renderbuffer = GL.renderbuffers[id];
        if (!renderbuffer) continue; // GL spec: "glDeleteRenderbuffers silently ignores 0s and names that do not correspond to existing renderbuffer objects".
        GLctx.deleteRenderbuffer(renderbuffer);
        renderbuffer.name = 0;
        GL.renderbuffers[id] = null;
      }
    }

  function _emscripten_glDeleteSamplers(n, samplers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((samplers)+(i*4))>>2)];
        var sampler = GL.samplers[id];
        if (!sampler) continue;
        GLctx['deleteSampler'](sampler);
        sampler.name = 0;
        GL.samplers[id] = null;
      }
    }

  function _emscripten_glDeleteShader(id) {
      if (!id) return;
      var shader = GL.shaders[id];
      if (!shader) { // glDeleteShader actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteShader(shader);
      GL.shaders[id] = null;
    }

  function _emscripten_glDeleteSync(id) {
      if (!id) return;
      var sync = GL.syncs[id];
      if (!sync) { // glDeleteSync signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteSync(sync);
      sync.name = 0;
      GL.syncs[id] = null;
    }

  function _emscripten_glDeleteTextures(n, textures) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((textures)+(i*4))>>2)];
        var texture = GL.textures[id];
        if (!texture) continue; // GL spec: "glDeleteTextures silently ignores 0s and names that do not correspond to existing textures".
        GLctx.deleteTexture(texture);
        texture.name = 0;
        GL.textures[id] = null;
      }
    }

  function _emscripten_glDeleteTransformFeedbacks(n, ids) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((ids)+(i*4))>>2)];
        var transformFeedback = GL.transformFeedbacks[id];
        if (!transformFeedback) continue; // GL spec: "unused names in ids are ignored, as is the name zero."
        GLctx['deleteTransformFeedback'](transformFeedback);
        transformFeedback.name = 0;
        GL.transformFeedbacks[id] = null;
      }
    }

  function _emscripten_glDeleteVertexArrays(n, vaos) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((vaos)+(i*4))>>2)];
        GLctx['deleteVertexArray'](GL.vaos[id]);
        GL.vaos[id] = null;
      }
    }

  function _emscripten_glDeleteVertexArraysOES(n, vaos) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((vaos)+(i*4))>>2)];
        GLctx['deleteVertexArray'](GL.vaos[id]);
        GL.vaos[id] = null;
      }
    }

  function _emscripten_glDepthFunc(x0) { GLctx['depthFunc'](x0) }

  function _emscripten_glDepthMask(flag) {
      GLctx.depthMask(!!flag);
    }

  function _emscripten_glDepthRangef(x0, x1) { GLctx['depthRange'](x0, x1) }

  function _emscripten_glDetachShader(program, shader) {
      GLctx.detachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _emscripten_glDisable(x0) { GLctx['disable'](x0) }

  function _emscripten_glDisableVertexAttribArray(index) {
      GLctx.disableVertexAttribArray(index);
    }

  function _emscripten_glDrawArrays(mode, first, count) {
  
      GLctx.drawArrays(mode, first, count);
  
    }

  function _emscripten_glDrawArraysInstanced(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  function _emscripten_glDrawArraysInstancedANGLE(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  function _emscripten_glDrawArraysInstancedARB(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  function _emscripten_glDrawArraysInstancedEXT(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  function _emscripten_glDrawArraysInstancedNV(mode, first, count, primcount) {
      GLctx['drawArraysInstanced'](mode, first, count, primcount);
    }

  
  var __tempFixedLengthArray=[];function _emscripten_glDrawBuffers(n, bufs) {
  
      var bufArray = __tempFixedLengthArray[n];
      for (var i = 0; i < n; i++) {
        bufArray[i] = HEAP32[(((bufs)+(i*4))>>2)];
      }
  
      GLctx['drawBuffers'](bufArray);
    }

  function _emscripten_glDrawBuffersEXT(n, bufs) {
  
      var bufArray = __tempFixedLengthArray[n];
      for (var i = 0; i < n; i++) {
        bufArray[i] = HEAP32[(((bufs)+(i*4))>>2)];
      }
  
      GLctx['drawBuffers'](bufArray);
    }

  function _emscripten_glDrawBuffersWEBGL(n, bufs) {
  
      var bufArray = __tempFixedLengthArray[n];
      for (var i = 0; i < n; i++) {
        bufArray[i] = HEAP32[(((bufs)+(i*4))>>2)];
      }
  
      GLctx['drawBuffers'](bufArray);
    }

  function _emscripten_glDrawElements(mode, count, type, indices) {
  
      GLctx.drawElements(mode, count, type, indices);
  
    }

  function _emscripten_glDrawElementsInstanced(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  function _emscripten_glDrawElementsInstancedANGLE(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  function _emscripten_glDrawElementsInstancedARB(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  function _emscripten_glDrawElementsInstancedEXT(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  function _emscripten_glDrawElementsInstancedNV(mode, count, type, indices, primcount) {
      GLctx['drawElementsInstanced'](mode, count, type, indices, primcount);
    }

  
  function _glDrawElements(mode, count, type, indices) {
  
      GLctx.drawElements(mode, count, type, indices);
  
    }function _emscripten_glDrawRangeElements(mode, start, end, count, type, indices) {
      // TODO: This should be a trivial pass-though function registered at the bottom of this page as
      // glFuncs[6][1] += ' drawRangeElements';
      // but due to https://bugzilla.mozilla.org/show_bug.cgi?id=1202427,
      // we work around by ignoring the range.
      _glDrawElements(mode, count, type, indices);
    }

  function _emscripten_glEnable(x0) { GLctx['enable'](x0) }

  function _emscripten_glEnableVertexAttribArray(index) {
      GLctx.enableVertexAttribArray(index);
    }

  function _emscripten_glEndQuery(x0) { GLctx['endQuery'](x0) }

  function _emscripten_glEndQueryEXT(target) {
      GLctx.disjointTimerQueryExt['endQueryEXT'](target);
    }

  function _emscripten_glEndTransformFeedback() { GLctx['endTransformFeedback']() }

  function _emscripten_glFenceSync(condition, flags) {
      var sync = GLctx.fenceSync(condition, flags);
      if (sync) {
        var id = GL.getNewId(GL.syncs);
        sync.name = id;
        GL.syncs[id] = sync;
        return id;
      } else {
        return 0; // Failed to create a sync object
      }
    }

  function _emscripten_glFinish() { GLctx['finish']() }

  function _emscripten_glFlush() { GLctx['flush']() }

  function _emscripten_glFlushMappedBufferRange(
  ) {
  err('missing function: emscripten_glFlushMappedBufferRange'); abort(-1);
  }

  function _emscripten_glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
      GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget,
                                         GL.renderbuffers[renderbuffer]);
    }

  function _emscripten_glFramebufferTexture2D(target, attachment, textarget, texture, level) {
      GLctx.framebufferTexture2D(target, attachment, textarget,
                                      GL.textures[texture], level);
    }

  function _emscripten_glFramebufferTextureLayer(target, attachment, texture, level, layer) {
      GLctx.framebufferTextureLayer(target, attachment, GL.textures[texture], level, layer);
    }

  function _emscripten_glFrontFace(x0) { GLctx['frontFace'](x0) }

  
  function __glGenObject(n, buffers, createFunction, objectTable
      ) {
      for (var i = 0; i < n; i++) {
        var buffer = GLctx[createFunction]();
        var id = buffer && GL.getNewId(objectTable);
        if (buffer) {
          buffer.name = id;
          objectTable[id] = buffer;
        } else {
          GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        }
        HEAP32[(((buffers)+(i*4))>>2)]=id;
      }
    }function _emscripten_glGenBuffers(n, buffers) {
      __glGenObject(n, buffers, 'createBuffer', GL.buffers
        );
    }

  function _emscripten_glGenFramebuffers(n, ids) {
      __glGenObject(n, ids, 'createFramebuffer', GL.framebuffers
        );
    }

  function _emscripten_glGenQueries(n, ids) {
      __glGenObject(n, ids, 'createQuery', GL.queries
        );
    }

  function _emscripten_glGenQueriesEXT(n, ids) {
      for (var i = 0; i < n; i++) {
        var query = GLctx.disjointTimerQueryExt['createQueryEXT']();
        if (!query) {
          GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
          while(i < n) HEAP32[(((ids)+(i++*4))>>2)]=0;
          return;
        }
        var id = GL.getNewId(GL.timerQueriesEXT);
        query.name = id;
        GL.timerQueriesEXT[id] = query;
        HEAP32[(((ids)+(i*4))>>2)]=id;
      }
    }

  function _emscripten_glGenRenderbuffers(n, renderbuffers) {
      __glGenObject(n, renderbuffers, 'createRenderbuffer', GL.renderbuffers
        );
    }

  function _emscripten_glGenSamplers(n, samplers) {
      __glGenObject(n, samplers, 'createSampler', GL.samplers
        );
    }

  function _emscripten_glGenTextures(n, textures) {
      __glGenObject(n, textures, 'createTexture', GL.textures
        );
    }

  function _emscripten_glGenTransformFeedbacks(n, ids) {
      __glGenObject(n, ids, 'createTransformFeedback', GL.transformFeedbacks
        );
    }

  function _emscripten_glGenVertexArrays(n, arrays) {
      __glGenObject(n, arrays, 'createVertexArray', GL.vaos
        );
    }

  function _emscripten_glGenVertexArraysOES(n, arrays) {
      __glGenObject(n, arrays, 'createVertexArray', GL.vaos
        );
    }

  function _emscripten_glGenerateMipmap(x0) { GLctx['generateMipmap'](x0) }

  function _emscripten_glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveAttrib(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size and type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _emscripten_glGetActiveUniform(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveUniform(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size, type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _emscripten_glGetActiveUniformBlockName(program, uniformBlockIndex, bufSize, length, uniformBlockName) {
      program = GL.programs[program];
  
      var result = GLctx['getActiveUniformBlockName'](program, uniformBlockIndex);
      if (!result) return; // If an error occurs, nothing will be written to uniformBlockName or length.
      if (uniformBlockName && bufSize > 0) {
        var numBytesWrittenExclNull = stringToUTF8(result, uniformBlockName, bufSize);
        if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      } else {
        if (length) HEAP32[((length)>>2)]=0;
      }
    }

  function _emscripten_glGetActiveUniformBlockiv(program, uniformBlockIndex, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      program = GL.programs[program];
  
      switch(pname) {
        case 0x8A41: /* GL_UNIFORM_BLOCK_NAME_LENGTH */
          var name = GLctx['getActiveUniformBlockName'](program, uniformBlockIndex);
          HEAP32[((params)>>2)]=name.length+1;
          return;
        default:
          var result = GLctx['getActiveUniformBlockParameter'](program, uniformBlockIndex, pname);
          if (!result) return; // If an error occurs, nothing will be written to params.
          if (typeof result == 'number') {
            HEAP32[((params)>>2)]=result;
          } else {
            for (var i = 0; i < result.length; i++) {
              HEAP32[(((params)+(i*4))>>2)]=result[i];
            }
          }
      }
    }

  function _emscripten_glGetActiveUniformsiv(program, uniformCount, uniformIndices, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (uniformCount > 0 && uniformIndices == 0) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      program = GL.programs[program];
      var ids = [];
      for (var i = 0; i < uniformCount; i++) {
        ids.push(HEAP32[(((uniformIndices)+(i*4))>>2)]);
      }
  
      var result = GLctx['getActiveUniforms'](program, ids, pname);
      if (!result) return; // GL spec: If an error is generated, nothing is written out to params.
  
      var len = result.length;
      for (var i = 0; i < len; i++) {
        HEAP32[(((params)+(i*4))>>2)]=result[i];
      }
    }

  function _emscripten_glGetAttachedShaders(program, maxCount, count, shaders) {
      var result = GLctx.getAttachedShaders(GL.programs[program]);
      var len = result.length;
      if (len > maxCount) {
        len = maxCount;
      }
      HEAP32[((count)>>2)]=len;
      for (var i = 0; i < len; ++i) {
        var id = GL.shaders.indexOf(result[i]);
        HEAP32[(((shaders)+(i*4))>>2)]=id;
      }
    }

  function _emscripten_glGetAttribLocation(program, name) {
      return GLctx.getAttribLocation(GL.programs[program], UTF8ToString(name));
    }

  
  function emscriptenWebGLGet(name_, p, type) {
      // Guard against user passing a null pointer.
      // Note that GLES2 spec does not say anything about how passing a null pointer should be treated.
      // Testing on desktop core GL 3, the application crashes on glGetIntegerv to a null pointer, but
      // better to report an error instead of doing anything random.
      if (!p) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var ret = undefined;
      switch(name_) { // Handle a few trivial GLES values
        case 0x8DFA: // GL_SHADER_COMPILER
          ret = 1;
          break;
        case 0x8DF8: // GL_SHADER_BINARY_FORMATS
          if (type != 0 && type != 1) {
            GL.recordError(0x0500); // GL_INVALID_ENUM
          }
          return; // Do not write anything to the out pointer, since no binary formats are supported.
        case 0x87FE: // GL_NUM_PROGRAM_BINARY_FORMATS
        case 0x8DF9: // GL_NUM_SHADER_BINARY_FORMATS
          ret = 0;
          break;
        case 0x86A2: // GL_NUM_COMPRESSED_TEXTURE_FORMATS
          // WebGL doesn't have GL_NUM_COMPRESSED_TEXTURE_FORMATS (it's obsolete since GL_COMPRESSED_TEXTURE_FORMATS returns a JS array that can be queried for length),
          // so implement it ourselves to allow C++ GLES2 code get the length.
          var formats = GLctx.getParameter(0x86A3 /*GL_COMPRESSED_TEXTURE_FORMATS*/);
          ret = formats ? formats.length : 0;
          break;
        case 0x821D: // GL_NUM_EXTENSIONS
          if (GL.currentContext.version < 2) {
            GL.recordError(0x0502 /* GL_INVALID_OPERATION */); // Calling GLES3/WebGL2 function with a GLES2/WebGL1 context
            return;
          }
          var exts = GLctx.getSupportedExtensions();
          ret = 2 * exts.length; // each extension is duplicated, first in unprefixed WebGL form, and then a second time with "GL_" prefix.
          break;
        case 0x821B: // GL_MAJOR_VERSION
        case 0x821C: // GL_MINOR_VERSION
          if (GL.currentContext.version < 2) {
            GL.recordError(0x0500); // GL_INVALID_ENUM
            return;
          }
          ret = name_ == 0x821B ? 3 : 0; // return version 3.0
          break;
      }
  
      if (ret === undefined) {
        var result = GLctx.getParameter(name_);
        switch (typeof(result)) {
          case "number":
            ret = result;
            break;
          case "boolean":
            ret = result ? 1 : 0;
            break;
          case "string":
            GL.recordError(0x0500); // GL_INVALID_ENUM
            return;
          case "object":
            if (result === null) {
              // null is a valid result for some (e.g., which buffer is bound - perhaps nothing is bound), but otherwise
              // can mean an invalid name_, which we need to report as an error
              switch(name_) {
                case 0x8894: // ARRAY_BUFFER_BINDING
                case 0x8B8D: // CURRENT_PROGRAM
                case 0x8895: // ELEMENT_ARRAY_BUFFER_BINDING
                case 0x8CA6: // FRAMEBUFFER_BINDING
                case 0x8CA7: // RENDERBUFFER_BINDING
                case 0x8069: // TEXTURE_BINDING_2D
                case 0x85B5: // WebGL 2 GL_VERTEX_ARRAY_BINDING, or WebGL 1 extension OES_vertex_array_object GL_VERTEX_ARRAY_BINDING_OES
                case 0x8919: // GL_SAMPLER_BINDING
                case 0x8E25: // GL_TRANSFORM_FEEDBACK_BINDING
                case 0x8514: { // TEXTURE_BINDING_CUBE_MAP
                  ret = 0;
                  break;
                }
                default: {
                  GL.recordError(0x0500); // GL_INVALID_ENUM
                  return;
                }
              }
            } else if (result instanceof Float32Array ||
                       result instanceof Uint32Array ||
                       result instanceof Int32Array ||
                       result instanceof Array) {
              for (var i = 0; i < result.length; ++i) {
                switch (type) {
                  case 0: HEAP32[(((p)+(i*4))>>2)]=result[i]; break;
                  case 2: HEAPF32[(((p)+(i*4))>>2)]=result[i]; break;
                  case 4: HEAP8[(((p)+(i))>>0)]=result[i] ? 1 : 0; break;
                }
              }
              return;
            } else {
              try {
                ret = result.name | 0;
              } catch(e) {
                GL.recordError(0x0500); // GL_INVALID_ENUM
                err('GL_INVALID_ENUM in glGet' + type + 'v: Unknown object returned from WebGL getParameter(' + name_ + ')! (error: ' + e + ')');
                return;
              }
            }
            break;
          default:
            GL.recordError(0x0500); // GL_INVALID_ENUM
            err('GL_INVALID_ENUM in glGet' + type + 'v: Native code calling glGet' + type + 'v(' + name_ + ') and it returns ' + result + ' of type ' + typeof(result) + '!');
            return;
        }
      }
  
      switch (type) {
        case 1: (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((p)>>2)]=tempI64[0],HEAP32[(((p)+(4))>>2)]=tempI64[1]);    break;
        case 0: HEAP32[((p)>>2)]=ret;    break;
        case 2:   HEAPF32[((p)>>2)]=ret;  break;
        case 4: HEAP8[((p)>>0)]=ret ? 1 : 0; break;
      }
    }function _emscripten_glGetBooleanv(name_, p) {
      emscriptenWebGLGet(name_, p, 4);
    }

  function _emscripten_glGetBufferParameteri64v(target, value, data) {
      if (!data) {
        // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
        // if data == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      (tempI64 = [GLctx.getBufferParameter(target, value)>>>0,(tempDouble=GLctx.getBufferParameter(target, value),(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((data)>>2)]=tempI64[0],HEAP32[(((data)+(4))>>2)]=tempI64[1]);
    }

  function _emscripten_glGetBufferParameteriv(target, value, data) {
      if (!data) {
        // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
        // if data == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((data)>>2)]=GLctx.getBufferParameter(target, value);
    }

  function _emscripten_glGetBufferPointerv(
  ) {
  err('missing function: emscripten_glGetBufferPointerv'); abort(-1);
  }

  function _emscripten_glGetError() {
      // First return any GL error generated by the emscripten library_webgl.js interop layer.
      if (GL.lastError) {
        var error = GL.lastError;
        GL.lastError = 0/*GL_NO_ERROR*/;
        return error;
      } else
      { // If there were none, return the GL error from the browser GL context.
        return GLctx.getError();
      }
    }

  function _emscripten_glGetFloatv(name_, p) {
      emscriptenWebGLGet(name_, p, 2);
    }

  function _emscripten_glGetFragDataLocation(program, name) {
      return GLctx['getFragDataLocation'](GL.programs[program], UTF8ToString(name));
    }

  function _emscripten_glGetFramebufferAttachmentParameteriv(target, attachment, pname, params) {
      var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
      if (result instanceof WebGLRenderbuffer ||
          result instanceof WebGLTexture) {
        result = result.name | 0;
      }
      HEAP32[((params)>>2)]=result;
    }

  
  function emscriptenWebGLGetIndexed(target, index, data, type) {
      if (!data) {
        // GLES2 specification does not specify how to behave if data is a null pointer. Since calling this function does not make sense
        // if data == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var result = GLctx['getIndexedParameter'](target, index);
      var ret;
      switch (typeof result) {
        case 'boolean':
          ret = result ? 1 : 0;
          break;
        case 'number':
          ret = result;
          break;
        case 'object':
          if (result === null) {
            switch (target) {
              case 0x8C8F: // TRANSFORM_FEEDBACK_BUFFER_BINDING
              case 0x8A28: // UNIFORM_BUFFER_BINDING
                ret = 0;
                break;
              default: {
                GL.recordError(0x0500); // GL_INVALID_ENUM
                return;
              }
            }
          } else if (result instanceof WebGLBuffer) {
            ret = result.name | 0;
          } else {
            GL.recordError(0x0500); // GL_INVALID_ENUM
            return;
          }
          break;
        default:
          GL.recordError(0x0500); // GL_INVALID_ENUM
          return;
      }
  
      switch (type) {
        case 1: (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((data)>>2)]=tempI64[0],HEAP32[(((data)+(4))>>2)]=tempI64[1]); break;
        case 0: HEAP32[((data)>>2)]=ret; break;
        case 2: HEAPF32[((data)>>2)]=ret; break;
        case 4: HEAP8[((data)>>0)]=ret ? 1 : 0; break;
        default: throw 'internal emscriptenWebGLGetIndexed() error, bad type: ' + type;
      }
    }function _emscripten_glGetInteger64i_v(target, index, data) {
      emscriptenWebGLGetIndexed(target, index, data, 1);
    }

  function _emscripten_glGetInteger64v(name_, p) {
      emscriptenWebGLGet(name_, p, 1);
    }

  function _emscripten_glGetIntegeri_v(target, index, data) {
      emscriptenWebGLGetIndexed(target, index, data, 0);
    }

  function _emscripten_glGetIntegerv(name_, p) {
      emscriptenWebGLGet(name_, p, 0);
    }

  function _emscripten_glGetInternalformativ(target, internalformat, pname, bufSize, params) {
      if (bufSize < 0) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (!params) {
        // GLES3 specification does not specify how to behave if values is a null pointer. Since calling this function does not make sense
        // if values == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var ret = GLctx['getInternalformatParameter'](target, internalformat, pname);
      if (ret === null) return;
      for (var i = 0; i < ret.length && i < bufSize; ++i) {
        HEAP32[(((params)+(i))>>2)]=ret[i];
      }
    }

  function _emscripten_glGetProgramBinary(program, bufSize, length, binaryFormat, binary) {
      GL.recordError(0x0502/*GL_INVALID_OPERATION*/);
    }

  function _emscripten_glGetProgramInfoLog(program, maxLength, length, infoLog) {
      var log = GLctx.getProgramInfoLog(GL.programs[program]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetProgramiv(program, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      if (program >= GL.counter) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      var ptable = GL.programInfos[program];
      if (!ptable) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        return;
      }
  
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getProgramInfoLog(GL.programs[program]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B87 /* GL_ACTIVE_UNIFORM_MAX_LENGTH */) {
        HEAP32[((p)>>2)]=ptable.maxUniformLength;
      } else if (pname == 0x8B8A /* GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */) {
        if (ptable.maxAttributeLength == -1) {
          program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, 0x8B89/*GL_ACTIVE_ATTRIBUTES*/);
          ptable.maxAttributeLength = 0; // Spec says if there are no active attribs, 0 must be returned.
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxAttributeLength;
      } else if (pname == 0x8A35 /* GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH */) {
        if (ptable.maxUniformBlockNameLength == -1) {
          program = GL.programs[program];
          var numBlocks = GLctx.getProgramParameter(program, 0x8A36/*GL_ACTIVE_UNIFORM_BLOCKS*/);
          ptable.maxUniformBlockNameLength = 0;
          for (var i = 0; i < numBlocks; ++i) {
            var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
            ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxUniformBlockNameLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getProgramParameter(GL.programs[program], pname);
      }
    }

  function _emscripten_glGetQueryObjecti64vEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((params)>>2)]=tempI64[0],HEAP32[(((params)+(4))>>2)]=tempI64[1]);
    }

  function _emscripten_glGetQueryObjectivEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      HEAP32[((params)>>2)]=ret;
    }

  function _emscripten_glGetQueryObjectui64vEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      (tempI64 = [ret>>>0,(tempDouble=ret,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((params)>>2)]=tempI64[0],HEAP32[(((params)+(4))>>2)]=tempI64[1]);
    }

  function _emscripten_glGetQueryObjectuiv(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.queries[id];
      var param = GLctx['getQueryParameter'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      HEAP32[((params)>>2)]=ret;
    }

  function _emscripten_glGetQueryObjectuivEXT(id, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var query = GL.timerQueriesEXT[id];
      var param = GLctx.disjointTimerQueryExt['getQueryObjectEXT'](query, pname);
      var ret;
      if (typeof param == 'boolean') {
        ret = param ? 1 : 0;
      } else {
        ret = param;
      }
      HEAP32[((params)>>2)]=ret;
    }

  function _emscripten_glGetQueryiv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx['getQuery'](target, pname);
    }

  function _emscripten_glGetQueryivEXT(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.disjointTimerQueryExt['getQueryEXT'](target, pname);
    }

  function _emscripten_glGetRenderbufferParameteriv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.getRenderbufferParameter(target, pname);
    }

  function _emscripten_glGetSamplerParameterfv(sampler, pname, params) {
      if (!params) {
        // GLES3 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      sampler = GL.samplers[sampler];
      HEAPF32[((params)>>2)]=GLctx['getSamplerParameter'](sampler, pname);
    }

  function _emscripten_glGetSamplerParameteriv(sampler, pname, params) {
      if (!params) {
        // GLES3 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      sampler = GL.samplers[sampler];
      HEAP32[((params)>>2)]=GLctx['getSamplerParameter'](sampler, pname);
    }

  function _emscripten_glGetShaderInfoLog(shader, maxLength, length, infoLog) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetShaderPrecisionFormat(shaderType, precisionType, range, precision) {
      var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
      HEAP32[((range)>>2)]=result.rangeMin;
      HEAP32[(((range)+(4))>>2)]=result.rangeMax;
      HEAP32[((precision)>>2)]=result.precision;
    }

  function _emscripten_glGetShaderSource(shader, bufSize, length, source) {
      var result = GLctx.getShaderSource(GL.shaders[shader]);
      if (!result) return; // If an error occurs, nothing will be written to length or source.
      var numBytesWrittenExclNull = (bufSize > 0 && source) ? stringToUTF8(result, source, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _emscripten_glGetShaderiv(shader, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B88) { // GL_SHADER_SOURCE_LENGTH
        var source = GLctx.getShaderSource(GL.shaders[shader]);
        var sourceLength = (source === null || source.length == 0) ? 0 : source.length + 1;
        HEAP32[((p)>>2)]=sourceLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getShaderParameter(GL.shaders[shader], pname);
      }
    }

  
  function stringToNewUTF8(jsString) {
      var length = lengthBytesUTF8(jsString)+1;
      var cString = _malloc(length);
      stringToUTF8(jsString, cString, length);
      return cString;
    }function _emscripten_glGetString(name_) {
      if (GL.stringCache[name_]) return GL.stringCache[name_];
      var ret;
      switch(name_) {
        case 0x1F03 /* GL_EXTENSIONS */:
          var exts = GLctx.getSupportedExtensions();
          var gl_exts = [];
          for (var i = 0; i < exts.length; ++i) {
            gl_exts.push(exts[i]);
            gl_exts.push("GL_" + exts[i]);
          }
          ret = stringToNewUTF8(gl_exts.join(' '));
          break;
        case 0x1F00 /* GL_VENDOR */:
        case 0x1F01 /* GL_RENDERER */:
        case 0x9245 /* UNMASKED_VENDOR_WEBGL */:
        case 0x9246 /* UNMASKED_RENDERER_WEBGL */:
          var s = GLctx.getParameter(name_);
          if (!s) {
            GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          }
          ret = stringToNewUTF8(s);
          break;
  
        case 0x1F02 /* GL_VERSION */:
          var glVersion = GLctx.getParameter(GLctx.VERSION);
          // return GLES version string corresponding to the version of the WebGL context
          if (GL.currentContext.version >= 2) glVersion = 'OpenGL ES 3.0 (' + glVersion + ')';
          else
          {
            glVersion = 'OpenGL ES 2.0 (' + glVersion + ')';
          }
          ret = stringToNewUTF8(glVersion);
          break;
        case 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */:
          var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
          // extract the version number 'N.M' from the string 'WebGL GLSL ES N.M ...'
          var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
          var ver_num = glslVersion.match(ver_re);
          if (ver_num !== null) {
            if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + '0'; // ensure minor version has 2 digits
            glslVersion = 'OpenGL ES GLSL ES ' + ver_num[1] + ' (' + glslVersion + ')';
          }
          ret = stringToNewUTF8(glslVersion);
          break;
        default:
          GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          return 0;
      }
      GL.stringCache[name_] = ret;
      return ret;
    }

  function _emscripten_glGetStringi(name, index) {
      if (GL.currentContext.version < 2) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */); // Calling GLES3/WebGL2 function with a GLES2/WebGL1 context
        return 0;
      }
      var stringiCache = GL.stringiCache[name];
      if (stringiCache) {
        if (index < 0 || index >= stringiCache.length) {
          GL.recordError(0x0501/*GL_INVALID_VALUE*/);
          return 0;
        }
        return stringiCache[index];
      }
      switch(name) {
        case 0x1F03 /* GL_EXTENSIONS */:
          var exts = GLctx.getSupportedExtensions();
          var gl_exts = [];
          for (var i = 0; i < exts.length; ++i) {
            gl_exts.push(stringToNewUTF8(exts[i]));
            // each extension is duplicated, first in unprefixed WebGL form, and then a second time with "GL_" prefix.
            gl_exts.push(stringToNewUTF8('GL_' + exts[i]));
          }
          stringiCache = GL.stringiCache[name] = gl_exts;
          if (index < 0 || index >= stringiCache.length) {
            GL.recordError(0x0501/*GL_INVALID_VALUE*/);
            return 0;
          }
          return stringiCache[index];
        default:
          GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          return 0;
      }
    }

  function _emscripten_glGetSynciv(sync, pname, bufSize, length, values) {
      if (bufSize < 0) {
        // GLES3 specification does not specify how to behave if bufSize < 0, however in the spec wording for glGetInternalformativ, it does say that GL_INVALID_VALUE should be raised,
        // so raise GL_INVALID_VALUE here as well.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (!values) {
        // GLES3 specification does not specify how to behave if values is a null pointer. Since calling this function does not make sense
        // if values == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var ret = GLctx.getSyncParameter(GL.syncs[sync], pname);
      HEAP32[((length)>>2)]=ret;
      if (ret !== null && length) HEAP32[((length)>>2)]=1; // Report a single value outputted.
    }

  function _emscripten_glGetTexParameterfv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAPF32[((params)>>2)]=GLctx.getTexParameter(target, pname);
    }

  function _emscripten_glGetTexParameteriv(target, pname, params) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((params)>>2)]=GLctx.getTexParameter(target, pname);
    }

  function _emscripten_glGetTransformFeedbackVarying(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx['getTransformFeedbackVarying'](program, index);
      if (!info) return; // If an error occurred, the return parameters length, size, type and name will be unmodified.
  
      if (name && bufSize > 0) {
        var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
        if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      } else {
        if (length) HEAP32[((length)>>2)]=0;
      }
  
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _emscripten_glGetUniformBlockIndex(program, uniformBlockName) {
      return GLctx['getUniformBlockIndex'](GL.programs[program], UTF8ToString(uniformBlockName));
    }

  function _emscripten_glGetUniformIndices(program, uniformCount, uniformNames, uniformIndices) {
      if (!uniformIndices) {
        // GLES2 specification does not specify how to behave if uniformIndices is a null pointer. Since calling this function does not make sense
        // if uniformIndices == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (uniformCount > 0 && (uniformNames == 0 || uniformIndices == 0)) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      program = GL.programs[program];
      var names = [];
      for (var i = 0; i < uniformCount; i++)
        names.push(UTF8ToString(HEAP32[(((uniformNames)+(i*4))>>2)]));
  
      var result = GLctx['getUniformIndices'](program, names);
      if (!result) return; // GL spec: If an error is generated, nothing is written out to uniformIndices.
  
      var len = result.length;
      for (var i = 0; i < len; i++) {
        HEAP32[(((uniformIndices)+(i*4))>>2)]=result[i];
      }
    }

  function _emscripten_glGetUniformLocation(program, name) {
      name = UTF8ToString(name);
  
      var arrayIndex = 0;
      // If user passed an array accessor "[index]", parse the array index off the accessor.
      if (name[name.length - 1] == ']') {
        var leftBrace = name.lastIndexOf('[');
        arrayIndex = name[leftBrace+1] != ']' ? parseInt(name.slice(leftBrace + 1)) : 0; // "index]", parseInt will ignore the ']' at the end; but treat "foo[]" as "foo[0]"
        name = name.slice(0, leftBrace);
      }
  
      var uniformInfo = GL.programInfos[program] && GL.programInfos[program].uniforms[name]; // returns pair [ dimension_of_uniform_array, uniform_location ]
      if (uniformInfo && arrayIndex >= 0 && arrayIndex < uniformInfo[0]) { // Check if user asked for an out-of-bounds element, i.e. for 'vec4 colors[3];' user could ask for 'colors[10]' which should return -1.
        return uniformInfo[1] + arrayIndex;
      } else {
        return -1;
      }
    }

  
  function emscriptenWebGLGetUniform(program, location, params, type) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var data = GLctx.getUniform(GL.programs[program], GL.uniforms[location]);
      if (typeof data == 'number' || typeof data == 'boolean') {
        switch (type) {
          case 0: HEAP32[((params)>>2)]=data; break;
          case 2: HEAPF32[((params)>>2)]=data; break;
          default: throw 'internal emscriptenWebGLGetUniform() error, bad type: ' + type;
        }
      } else {
        for (var i = 0; i < data.length; i++) {
          switch (type) {
            case 0: HEAP32[(((params)+(i*4))>>2)]=data[i]; break;
            case 2: HEAPF32[(((params)+(i*4))>>2)]=data[i]; break;
            default: throw 'internal emscriptenWebGLGetUniform() error, bad type: ' + type;
          }
        }
      }
    }function _emscripten_glGetUniformfv(program, location, params) {
      emscriptenWebGLGetUniform(program, location, params, 2);
    }

  function _emscripten_glGetUniformiv(program, location, params) {
      emscriptenWebGLGetUniform(program, location, params, 0);
    }

  function _emscripten_glGetUniformuiv(program, location, params) {
      emscriptenWebGLGetUniform(program, location, params, 0);
    }

  
  function emscriptenWebGLGetVertexAttrib(index, pname, params, type) {
      if (!params) {
        // GLES2 specification does not specify how to behave if params is a null pointer. Since calling this function does not make sense
        // if params == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      var data = GLctx.getVertexAttrib(index, pname);
      if (pname == 0x889F/*VERTEX_ATTRIB_ARRAY_BUFFER_BINDING*/) {
        HEAP32[((params)>>2)]=data["name"];
      } else if (typeof data == 'number' || typeof data == 'boolean') {
        switch (type) {
          case 0: HEAP32[((params)>>2)]=data; break;
          case 2: HEAPF32[((params)>>2)]=data; break;
          case 5: HEAP32[((params)>>2)]=Math.fround(data); break;
          default: throw 'internal emscriptenWebGLGetVertexAttrib() error, bad type: ' + type;
        }
      } else {
        for (var i = 0; i < data.length; i++) {
          switch (type) {
            case 0: HEAP32[(((params)+(i*4))>>2)]=data[i]; break;
            case 2: HEAPF32[(((params)+(i*4))>>2)]=data[i]; break;
            case 5: HEAP32[(((params)+(i*4))>>2)]=Math.fround(data[i]); break;
            default: throw 'internal emscriptenWebGLGetVertexAttrib() error, bad type: ' + type;
          }
        }
      }
    }function _emscripten_glGetVertexAttribIiv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttribI4iv(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 0);
    }

  function _emscripten_glGetVertexAttribIuiv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttribI4iv(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 0);
    }

  function _emscripten_glGetVertexAttribPointerv(index, pname, pointer) {
      if (!pointer) {
        // GLES2 specification does not specify how to behave if pointer is a null pointer. Since calling this function does not make sense
        // if pointer == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      HEAP32[((pointer)>>2)]=GLctx.getVertexAttribOffset(index, pname);
    }

  function _emscripten_glGetVertexAttribfv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttrib*f(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 2);
    }

  function _emscripten_glGetVertexAttribiv(index, pname, params) {
      // N.B. This function may only be called if the vertex attribute was specified using the function glVertexAttrib*f(),
      // otherwise the results are undefined. (GLES3 spec 6.1.12)
      emscriptenWebGLGetVertexAttrib(index, pname, params, 5);
    }

  function _emscripten_glHint(x0, x1) { GLctx['hint'](x0, x1) }

  function _emscripten_glInvalidateFramebuffer(target, numAttachments, attachments) {
      var list = __tempFixedLengthArray[numAttachments];
      for (var i = 0; i < numAttachments; i++) {
        list[i] = HEAP32[(((attachments)+(i*4))>>2)];
      }
  
      GLctx['invalidateFramebuffer'](target, list);
    }

  function _emscripten_glInvalidateSubFramebuffer(target, numAttachments, attachments, x, y, width, height) {
      var list = __tempFixedLengthArray[numAttachments];
      for (var i = 0; i < numAttachments; i++) {
        list[i] = HEAP32[(((attachments)+(i*4))>>2)];
      }
  
      GLctx['invalidateSubFramebuffer'](target, list, x, y, width, height);
    }

  function _emscripten_glIsBuffer(buffer) {
      var b = GL.buffers[buffer];
      if (!b) return 0;
      return GLctx.isBuffer(b);
    }

  function _emscripten_glIsEnabled(x0) { return GLctx['isEnabled'](x0) }

  function _emscripten_glIsFramebuffer(framebuffer) {
      var fb = GL.framebuffers[framebuffer];
      if (!fb) return 0;
      return GLctx.isFramebuffer(fb);
    }

  function _emscripten_glIsProgram(program) {
      program = GL.programs[program];
      if (!program) return 0;
      return GLctx.isProgram(program);
    }

  function _emscripten_glIsQuery(id) {
      var query = GL.queries[id];
      if (!query) return 0;
      return GLctx['isQuery'](query);
    }

  function _emscripten_glIsQueryEXT(id) {
      var query = GL.timerQueriesEXT[id];
      if (!query) return 0;
      return GLctx.disjointTimerQueryExt['isQueryEXT'](query);
    }

  function _emscripten_glIsRenderbuffer(renderbuffer) {
      var rb = GL.renderbuffers[renderbuffer];
      if (!rb) return 0;
      return GLctx.isRenderbuffer(rb);
    }

  function _emscripten_glIsSampler(id) {
      var sampler = GL.samplers[id];
      if (!sampler) return 0;
      return GLctx['isSampler'](sampler);
    }

  function _emscripten_glIsShader(shader) {
      var s = GL.shaders[shader];
      if (!s) return 0;
      return GLctx.isShader(s);
    }

  function _emscripten_glIsSync(sync) {
      var sync = GL.syncs[sync];
      if (!sync) return 0;
      return GLctx.isSync(sync);
    }

  function _emscripten_glIsTexture(id) {
      var texture = GL.textures[id];
      if (!texture) return 0;
      return GLctx.isTexture(texture);
    }

  function _emscripten_glIsTransformFeedback(id) {
      return GLctx['isTransformFeedback'](GL.transformFeedbacks[id]);
    }

  function _emscripten_glIsVertexArray(array) {
  
      var vao = GL.vaos[array];
      if (!vao) return 0;
      return GLctx['isVertexArray'](vao);
    }

  function _emscripten_glIsVertexArrayOES(array) {
  
      var vao = GL.vaos[array];
      if (!vao) return 0;
      return GLctx['isVertexArray'](vao);
    }

  function _emscripten_glLineWidth(x0) { GLctx['lineWidth'](x0) }

  function _emscripten_glLinkProgram(program) {
      GLctx.linkProgram(GL.programs[program]);
      GL.populateUniformTable(program);
    }

  function _emscripten_glMapBufferRange(
  ) {
  err('missing function: emscripten_glMapBufferRange'); abort(-1);
  }

  function _emscripten_glPauseTransformFeedback() { GLctx['pauseTransformFeedback']() }

  function _emscripten_glPixelStorei(pname, param) {
      if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
        GL.unpackAlignment = param;
      }
      GLctx.pixelStorei(pname, param);
    }

  function _emscripten_glPolygonOffset(x0, x1) { GLctx['polygonOffset'](x0, x1) }

  function _emscripten_glProgramBinary(program, binaryFormat, binary, length) {
      GL.recordError(0x0500/*GL_INVALID_ENUM*/);
    }

  function _emscripten_glProgramParameteri(program, pname, value) {
      GL.recordError(0x0500/*GL_INVALID_ENUM*/);
    }

  function _emscripten_glQueryCounterEXT(id, target) {
      GLctx.disjointTimerQueryExt['queryCounterEXT'](GL.timerQueriesEXT[id], target);
    }

  function _emscripten_glReadBuffer(x0) { GLctx['readBuffer'](x0) }

  
  
  function __computeUnpackAlignedImageSize(width, height, sizePerPixel, alignment) {
      function roundedToNextMultipleOf(x, y) {
        return (x + y - 1) & -y;
      }
      var plainRowSize = width * sizePerPixel;
      var alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
      return height * alignedRowSize;
    }
  
  var __colorChannelsInGlTextureFormat={6402:1,6403:1,6406:1,6407:3,6408:4,6409:1,6410:2,33319:2,33320:2,35904:3,35906:4,36244:1,36248:3,36249:4};
  
  var __sizeOfGlTextureElementType={5120:1,5121:1,5122:2,5123:2,5124:4,5125:4,5126:4,5131:2,32819:2,32820:2,33635:2,33640:4,34042:4,35899:4,35902:4,36193:2};function emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) {
      var sizePerPixel = __colorChannelsInGlTextureFormat[format] * __sizeOfGlTextureElementType[type];
      if (!sizePerPixel) {
        GL.recordError(0x0500); // GL_INVALID_ENUM
        return;
      }
      var bytes = __computeUnpackAlignedImageSize(width, height, sizePerPixel, GL.unpackAlignment);
      var end = pixels + bytes;
      switch(type) {
        case 0x1400 /* GL_BYTE */:
          return HEAP8.subarray(pixels, end);
        case 0x1401 /* GL_UNSIGNED_BYTE */:
          return HEAPU8.subarray(pixels, end);
        case 0x1402 /* GL_SHORT */:
          return HEAP16.subarray(pixels>>1, end>>1);
        case 0x1404 /* GL_INT */:
          return HEAP32.subarray(pixels>>2, end>>2);
        case 0x1406 /* GL_FLOAT */:
          return HEAPF32.subarray(pixels>>2, end>>2);
        case 0x1405 /* GL_UNSIGNED_INT */:
        case 0x84FA /* GL_UNSIGNED_INT_24_8_WEBGL/GL_UNSIGNED_INT_24_8 */:
        case 0x8C3E /* GL_UNSIGNED_INT_5_9_9_9_REV */:
        case 0x8368 /* GL_UNSIGNED_INT_2_10_10_10_REV */:
        case 0x8C3B /* GL_UNSIGNED_INT_10F_11F_11F_REV */:
          return HEAPU32.subarray(pixels>>2, end>>2);
        case 0x1403 /* GL_UNSIGNED_SHORT */:
        case 0x8363 /* GL_UNSIGNED_SHORT_5_6_5 */:
        case 0x8033 /* GL_UNSIGNED_SHORT_4_4_4_4 */:
        case 0x8034 /* GL_UNSIGNED_SHORT_5_5_5_1 */:
        case 0x8D61 /* GL_HALF_FLOAT_OES */:
        case 0x140B /* GL_HALF_FLOAT */:
          return HEAPU16.subarray(pixels>>1, end>>1);
        default:
          GL.recordError(0x0500); // GL_INVALID_ENUM
      }
    }
  
  function __heapObjectForWebGLType(type) {
      switch(type) {
        case 0x1400 /* GL_BYTE */:
          return HEAP8;
        case 0x1401 /* GL_UNSIGNED_BYTE */:
          return HEAPU8;
        case 0x1402 /* GL_SHORT */:
          return HEAP16;
        case 0x1403 /* GL_UNSIGNED_SHORT */:
        case 0x8363 /* GL_UNSIGNED_SHORT_5_6_5 */:
        case 0x8033 /* GL_UNSIGNED_SHORT_4_4_4_4 */:
        case 0x8034 /* GL_UNSIGNED_SHORT_5_5_5_1 */:
        case 0x8D61 /* GL_HALF_FLOAT_OES */:
        case 0x140B /* GL_HALF_FLOAT */:
          return HEAPU16;
        case 0x1404 /* GL_INT */:
          return HEAP32;
        case 0x1405 /* GL_UNSIGNED_INT */:
        case 0x84FA /* GL_UNSIGNED_INT_24_8_WEBGL/GL_UNSIGNED_INT_24_8 */:
        case 0x8C3E /* GL_UNSIGNED_INT_5_9_9_9_REV */:
        case 0x8368 /* GL_UNSIGNED_INT_2_10_10_10_REV */:
        case 0x8C3B /* GL_UNSIGNED_INT_10F_11F_11F_REV */:
        case 0x84FA /* GL_UNSIGNED_INT_24_8 */:
          return HEAPU32;
        case 0x1406 /* GL_FLOAT */:
          return HEAPF32;
      }
    }
  
  var __heapAccessShiftForWebGLType={5122:1,5123:1,5124:2,5125:2,5126:2,5131:1,32819:1,32820:1,33635:1,33640:2,34042:2,35899:2,35902:2,36193:1};function _emscripten_glReadPixels(x, y, width, height, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelPackBufferBinding) {
          GLctx.readPixels(x, y, width, height, format, type, pixels);
        } else {
          GLctx.readPixels(x, y, width, height, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        }
        return;
      }
      var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
      if (!pixelData) {
        GL.recordError(0x0500/*GL_INVALID_ENUM*/);
        return;
      }
      GLctx.readPixels(x, y, width, height, format, type, pixelData);
    }

  function _emscripten_glReleaseShaderCompiler() {
      // NOP (as allowed by GLES 2.0 spec)
    }

  function _emscripten_glRenderbufferStorage(x0, x1, x2, x3) { GLctx['renderbufferStorage'](x0, x1, x2, x3) }

  function _emscripten_glRenderbufferStorageMultisample(x0, x1, x2, x3, x4) { GLctx['renderbufferStorageMultisample'](x0, x1, x2, x3, x4) }

  function _emscripten_glResumeTransformFeedback() { GLctx['resumeTransformFeedback']() }

  function _emscripten_glSampleCoverage(value, invert) {
      GLctx.sampleCoverage(value, !!invert);
    }

  function _emscripten_glSamplerParameterf(sampler, pname, param) {
      GLctx['samplerParameterf'](GL.samplers[sampler], pname, param);
    }

  function _emscripten_glSamplerParameterfv(sampler, pname, params) {
      var param = HEAPF32[((params)>>2)];
      GLctx['samplerParameterf'](GL.samplers[sampler], pname, param);
    }

  function _emscripten_glSamplerParameteri(sampler, pname, param) {
      GLctx['samplerParameteri'](GL.samplers[sampler], pname, param);
    }

  function _emscripten_glSamplerParameteriv(sampler, pname, params) {
      var param = HEAP32[((params)>>2)];
      GLctx['samplerParameteri'](GL.samplers[sampler], pname, param);
    }

  function _emscripten_glScissor(x0, x1, x2, x3) { GLctx['scissor'](x0, x1, x2, x3) }

  function _emscripten_glShaderBinary() {
      GL.recordError(0x0500/*GL_INVALID_ENUM*/);
    }

  function _emscripten_glShaderSource(shader, count, string, length) {
      var source = GL.getSource(shader, count, string, length);
  
  
      GLctx.shaderSource(GL.shaders[shader], source);
    }

  function _emscripten_glStencilFunc(x0, x1, x2) { GLctx['stencilFunc'](x0, x1, x2) }

  function _emscripten_glStencilFuncSeparate(x0, x1, x2, x3) { GLctx['stencilFuncSeparate'](x0, x1, x2, x3) }

  function _emscripten_glStencilMask(x0) { GLctx['stencilMask'](x0) }

  function _emscripten_glStencilMaskSeparate(x0, x1) { GLctx['stencilMaskSeparate'](x0, x1) }

  function _emscripten_glStencilOp(x0, x1, x2) { GLctx['stencilOp'](x0, x1, x2) }

  function _emscripten_glStencilOpSeparate(x0, x1, x2, x3) { GLctx['stencilOpSeparate'](x0, x1, x2, x3) }

  function _emscripten_glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) {
        // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels);
        } else if (pixels != 0) {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        } else {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, null);
        }
        return;
      }
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) : null);
    }

  function _emscripten_glTexImage3D(target, level, internalFormat, width, height, depth, border, format, type, pixels) {
      if (GLctx.currentPixelUnpackBufferBinding) {
        GLctx['texImage3D'](target, level, internalFormat, width, height, depth, border, format, type, pixels);
      } else if (pixels != 0) {
        GLctx['texImage3D'](target, level, internalFormat, width, height, depth, border, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
      } else {
        GLctx['texImage3D'](target, level, internalFormat, width, height, depth, border, format, type, null);
      }
    }

  function _emscripten_glTexParameterf(x0, x1, x2) { GLctx['texParameterf'](x0, x1, x2) }

  function _emscripten_glTexParameterfv(target, pname, params) {
      var param = HEAPF32[((params)>>2)];
      GLctx.texParameterf(target, pname, param);
    }

  function _emscripten_glTexParameteri(x0, x1, x2) { GLctx['texParameteri'](x0, x1, x2) }

  function _emscripten_glTexParameteriv(target, pname, params) {
      var param = HEAP32[((params)>>2)];
      GLctx.texParameteri(target, pname, param);
    }

  function _emscripten_glTexStorage2D(x0, x1, x2, x3, x4) { GLctx['texStorage2D'](x0, x1, x2, x3, x4) }

  function _emscripten_glTexStorage3D(x0, x1, x2, x3, x4, x5) { GLctx['texStorage3D'](x0, x1, x2, x3, x4, x5) }

  function _emscripten_glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) {
        // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
        } else if (pixels != 0) {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        } else {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, null);
        }
        return;
      }
      var pixelData = null;
      if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, 0);
      GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
    }

  function _emscripten_glTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels) {
      if (GLctx.currentPixelUnpackBufferBinding) {
        GLctx['texSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels);
      } else if (pixels != 0) {
        GLctx['texSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
      } else {
        GLctx['texSubImage3D'](target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, null);
      }
    }

  function _emscripten_glTransformFeedbackVaryings(program, count, varyings, bufferMode) {
      program = GL.programs[program];
      var vars = [];
      for (var i = 0; i < count; i++)
        vars.push(UTF8ToString(HEAP32[(((varyings)+(i*4))>>2)]));
  
      GLctx['transformFeedbackVaryings'](program, vars, bufferMode);
    }

  function _emscripten_glUniform1f(location, v0) {
      GLctx.uniform1f(GL.uniforms[location], v0);
    }

  function _emscripten_glUniform1fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform1fv(GL.uniforms[location], HEAPF32, value>>2, count);
        return;
      }
  
      if (count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[count-1];
        for (var i = 0; i < count; ++i) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*4)>>2);
      }
      GLctx.uniform1fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform1i(location, v0) {
      GLctx.uniform1i(GL.uniforms[location], v0);
    }

  function _emscripten_glUniform1iv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform1iv(GL.uniforms[location], HEAP32, value>>2, count);
        return;
      }
  
      GLctx.uniform1iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*4)>>2));
    }

  function _emscripten_glUniform1ui(location, v0) {
      GLctx.uniform1ui(GL.uniforms[location], v0);
    }

  function _emscripten_glUniform1uiv(location, count, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform1uiv(GL.uniforms[location], HEAPU32, value>>2, count);
      } else {
        GLctx.uniform1uiv(GL.uniforms[location], HEAPU32.subarray((value)>>2,(value+count*4)>>2));
      }
    }

  function _emscripten_glUniform2f(location, v0, v1) {
      GLctx.uniform2f(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform2fv(GL.uniforms[location], HEAPF32, value>>2, count*2);
        return;
      }
  
      if (2*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[2*count-1];
        for (var i = 0; i < 2*count; i += 2) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*8)>>2);
      }
      GLctx.uniform2fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform2i(location, v0, v1) {
      GLctx.uniform2i(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2iv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform2iv(GL.uniforms[location], HEAP32, value>>2, count*2);
        return;
      }
  
      GLctx.uniform2iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*8)>>2));
    }

  function _emscripten_glUniform2ui(location, v0, v1) {
      GLctx.uniform2ui(GL.uniforms[location], v0, v1);
    }

  function _emscripten_glUniform2uiv(location, count, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform2uiv(GL.uniforms[location], HEAPU32, value>>2, count*2);
      } else {
        GLctx.uniform2uiv(GL.uniforms[location], HEAPU32.subarray((value)>>2,(value+count*8)>>2));
      }
    }

  function _emscripten_glUniform3f(location, v0, v1, v2) {
      GLctx.uniform3f(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform3fv(GL.uniforms[location], HEAPF32, value>>2, count*3);
        return;
      }
  
      if (3*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[3*count-1];
        for (var i = 0; i < 3*count; i += 3) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*12)>>2);
      }
      GLctx.uniform3fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform3i(location, v0, v1, v2) {
      GLctx.uniform3i(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3iv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform3iv(GL.uniforms[location], HEAP32, value>>2, count*3);
        return;
      }
  
      GLctx.uniform3iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*12)>>2));
    }

  function _emscripten_glUniform3ui(location, v0, v1, v2) {
      GLctx.uniform3ui(GL.uniforms[location], v0, v1, v2);
    }

  function _emscripten_glUniform3uiv(location, count, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform3uiv(GL.uniforms[location], HEAPU32, value>>2, count*3);
      } else {
        GLctx.uniform3uiv(GL.uniforms[location], HEAPU32.subarray((value)>>2,(value+count*12)>>2));
      }
    }

  function _emscripten_glUniform4f(location, v0, v1, v2, v3) {
      GLctx.uniform4f(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform4fv(GL.uniforms[location], HEAPF32, value>>2, count*4);
        return;
      }
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniform4fv(GL.uniforms[location], view);
    }

  function _emscripten_glUniform4i(location, v0, v1, v2, v3) {
      GLctx.uniform4i(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4iv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform4iv(GL.uniforms[location], HEAP32, value>>2, count*4);
        return;
      }
  
      GLctx.uniform4iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*16)>>2));
    }

  function _emscripten_glUniform4ui(location, v0, v1, v2, v3) {
      GLctx.uniform4ui(GL.uniforms[location], v0, v1, v2, v3);
    }

  function _emscripten_glUniform4uiv(location, count, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform4uiv(GL.uniforms[location], HEAPU32, value>>2, count*4);
      } else {
        GLctx.uniform4uiv(GL.uniforms[location], HEAPU32.subarray((value)>>2,(value+count*16)>>2));
      }
    }

  function _emscripten_glUniformBlockBinding(program, uniformBlockIndex, uniformBlockBinding) {
      program = GL.programs[program];
  
      GLctx['uniformBlockBinding'](program, uniformBlockIndex, uniformBlockBinding);
    }

  function _emscripten_glUniformMatrix2fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix2fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*4);
        return;
      }
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniformMatrix2fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUniformMatrix2x3fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix2x3fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*6);
      } else {
        GLctx.uniformMatrix2x3fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*24)>>2));
      }
    }

  function _emscripten_glUniformMatrix2x4fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix2x4fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*8);
      } else {
        GLctx.uniformMatrix2x4fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*32)>>2));
      }
    }

  function _emscripten_glUniformMatrix3fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*9);
        return;
      }
  
      if (9*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[9*count-1];
        for (var i = 0; i < 9*count; i += 9) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*36)>>2);
      }
      GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUniformMatrix3x2fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix3x2fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*6);
      } else {
        GLctx.uniformMatrix3x2fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*24)>>2));
      }
    }

  function _emscripten_glUniformMatrix3x4fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix3x4fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*12);
      } else {
        GLctx.uniformMatrix3x4fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*48)>>2));
      }
    }

  function _emscripten_glUniformMatrix4fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*16);
        return;
      }
  
      if (16*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[16*count-1];
        for (var i = 0; i < 16*count; i += 16) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
          view[i+9] = HEAPF32[(((value)+(4*i+36))>>2)];
          view[i+10] = HEAPF32[(((value)+(4*i+40))>>2)];
          view[i+11] = HEAPF32[(((value)+(4*i+44))>>2)];
          view[i+12] = HEAPF32[(((value)+(4*i+48))>>2)];
          view[i+13] = HEAPF32[(((value)+(4*i+52))>>2)];
          view[i+14] = HEAPF32[(((value)+(4*i+56))>>2)];
          view[i+15] = HEAPF32[(((value)+(4*i+60))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*64)>>2);
      }
      GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, view);
    }

  function _emscripten_glUniformMatrix4x2fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix4x2fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*8);
      } else {
        GLctx.uniformMatrix4x2fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*32)>>2));
      }
    }

  function _emscripten_glUniformMatrix4x3fv(location, count, transpose, value) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix4x3fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*12);
      } else {
        GLctx.uniformMatrix4x3fv(GL.uniforms[location], !!transpose, HEAPF32.subarray((value)>>2,(value+count*48)>>2));
      }
    }

  function _emscripten_glUnmapBuffer(
  ) {
  err('missing function: emscripten_glUnmapBuffer'); abort(-1);
  }

  function _emscripten_glUseProgram(program) {
      GLctx.useProgram(GL.programs[program]);
    }

  function _emscripten_glValidateProgram(program) {
      GLctx.validateProgram(GL.programs[program]);
    }

  function _emscripten_glVertexAttrib1f(x0, x1) { GLctx['vertexAttrib1f'](x0, x1) }

  function _emscripten_glVertexAttrib1fv(index, v) {
  
      GLctx.vertexAttrib1f(index, HEAPF32[v>>2]);
    }

  function _emscripten_glVertexAttrib2f(x0, x1, x2) { GLctx['vertexAttrib2f'](x0, x1, x2) }

  function _emscripten_glVertexAttrib2fv(index, v) {
  
      GLctx.vertexAttrib2f(index, HEAPF32[v>>2], HEAPF32[v+4>>2]);
    }

  function _emscripten_glVertexAttrib3f(x0, x1, x2, x3) { GLctx['vertexAttrib3f'](x0, x1, x2, x3) }

  function _emscripten_glVertexAttrib3fv(index, v) {
  
      GLctx.vertexAttrib3f(index, HEAPF32[v>>2], HEAPF32[v+4>>2], HEAPF32[v+8>>2]);
    }

  function _emscripten_glVertexAttrib4f(x0, x1, x2, x3, x4) { GLctx['vertexAttrib4f'](x0, x1, x2, x3, x4) }

  function _emscripten_glVertexAttrib4fv(index, v) {
  
      GLctx.vertexAttrib4f(index, HEAPF32[v>>2], HEAPF32[v+4>>2], HEAPF32[v+8>>2], HEAPF32[v+12>>2]);
    }

  function _emscripten_glVertexAttribDivisor(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribDivisorANGLE(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribDivisorARB(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribDivisorEXT(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribDivisorNV(index, divisor) {
      GLctx['vertexAttribDivisor'](index, divisor);
    }

  function _emscripten_glVertexAttribI4i(x0, x1, x2, x3, x4) { GLctx['vertexAttribI4i'](x0, x1, x2, x3, x4) }

  function _emscripten_glVertexAttribI4iv(index, v) {
      GLctx.vertexAttribI4i(index, HEAP32[v>>2], HEAP32[v+4>>2], HEAP32[v+8>>2], HEAP32[v+12>>2]);
    }

  function _emscripten_glVertexAttribI4ui(x0, x1, x2, x3, x4) { GLctx['vertexAttribI4ui'](x0, x1, x2, x3, x4) }

  function _emscripten_glVertexAttribI4uiv(index, v) {
      GLctx.vertexAttribI4ui(index, HEAPU32[v>>2], HEAPU32[v+4>>2], HEAPU32[v+8>>2], HEAPU32[v+12>>2]);
    }

  function _emscripten_glVertexAttribIPointer(index, size, type, stride, ptr) {
      GLctx['vertexAttribIPointer'](index, size, type, stride, ptr);
    }

  function _emscripten_glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
      GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
    }

  function _emscripten_glViewport(x0, x1, x2, x3) { GLctx['viewport'](x0, x1, x2, x3) }

  function _emscripten_glWaitSync(sync, flags, timeoutLo, timeoutHi) {
      // See WebGL2 vs GLES3 difference on GL_TIMEOUT_IGNORED above (https://www.khronos.org/registry/webgl/specs/latest/2.0/#5.15)
      timeoutLo = timeoutLo >>> 0;
      timeoutHi = timeoutHi >>> 0;
      var timeout = (timeoutLo == 0xFFFFFFFF && timeoutHi == 0xFFFFFFFF) ? -1 : makeBigInt(timeoutLo, timeoutHi, true);
      GLctx.waitSync(GL.syncs[sync], flags, timeout);
    }

   

  
  
  function __reallyNegative(x) {
      return x < 0 || (x === 0 && (1/x) === -Infinity);
    }function __formatString(format, varargs) {
      assert((varargs & 3) === 0);
      var textIndex = format;
      var argIndex = varargs;
      // This must be called before reading a double or i64 vararg. It will bump the pointer properly.
      // It also does an assert on i32 values, so it's nice to call it before all varargs calls.
      function prepVararg(ptr, type) {
        if (type === 'double' || type === 'i64') {
          // move so the load is aligned
          if (ptr & 7) {
            assert((ptr & 7) === 4);
            ptr += 4;
          }
        } else {
          assert((ptr & 3) === 0);
        }
        return ptr;
      }
      function getNextArg(type) {
        // NOTE: Explicitly ignoring type safety. Otherwise this fails:
        //       int x = 4; printf("%c\n", (char)x);
        var ret;
        argIndex = prepVararg(argIndex, type);
        if (type === 'double') {
          ret = HEAPF64[((argIndex)>>3)];
          argIndex += 8;
        } else if (type == 'i64') {
          ret = [HEAP32[((argIndex)>>2)],
                 HEAP32[(((argIndex)+(4))>>2)]];
          argIndex += 8;
        } else {
          assert((argIndex & 3) === 0);
          type = 'i32'; // varargs are always i32, i64, or double
          ret = HEAP32[((argIndex)>>2)];
          argIndex += 4;
        }
        return ret;
      }
  
      var ret = [];
      var curr, next, currArg;
      while(1) {
        var startTextIndex = textIndex;
        curr = HEAP8[((textIndex)>>0)];
        if (curr === 0) break;
        next = HEAP8[((textIndex+1)>>0)];
        if (curr == 37) {
          // Handle flags.
          var flagAlwaysSigned = false;
          var flagLeftAlign = false;
          var flagAlternative = false;
          var flagZeroPad = false;
          var flagPadSign = false;
          flagsLoop: while (1) {
            switch (next) {
              case 43:
                flagAlwaysSigned = true;
                break;
              case 45:
                flagLeftAlign = true;
                break;
              case 35:
                flagAlternative = true;
                break;
              case 48:
                if (flagZeroPad) {
                  break flagsLoop;
                } else {
                  flagZeroPad = true;
                  break;
                }
              case 32:
                flagPadSign = true;
                break;
              default:
                break flagsLoop;
            }
            textIndex++;
            next = HEAP8[((textIndex+1)>>0)];
          }
  
          // Handle width.
          var width = 0;
          if (next == 42) {
            width = getNextArg('i32');
            textIndex++;
            next = HEAP8[((textIndex+1)>>0)];
          } else {
            while (next >= 48 && next <= 57) {
              width = width * 10 + (next - 48);
              textIndex++;
              next = HEAP8[((textIndex+1)>>0)];
            }
          }
  
          // Handle precision.
          var precisionSet = false, precision = -1;
          if (next == 46) {
            precision = 0;
            precisionSet = true;
            textIndex++;
            next = HEAP8[((textIndex+1)>>0)];
            if (next == 42) {
              precision = getNextArg('i32');
              textIndex++;
            } else {
              while(1) {
                var precisionChr = HEAP8[((textIndex+1)>>0)];
                if (precisionChr < 48 ||
                    precisionChr > 57) break;
                precision = precision * 10 + (precisionChr - 48);
                textIndex++;
              }
            }
            next = HEAP8[((textIndex+1)>>0)];
          }
          if (precision < 0) {
            precision = 6; // Standard default.
            precisionSet = false;
          }
  
          // Handle integer sizes. WARNING: These assume a 32-bit architecture!
          var argSize;
          switch (String.fromCharCode(next)) {
            case 'h':
              var nextNext = HEAP8[((textIndex+2)>>0)];
              if (nextNext == 104) {
                textIndex++;
                argSize = 1; // char (actually i32 in varargs)
              } else {
                argSize = 2; // short (actually i32 in varargs)
              }
              break;
            case 'l':
              var nextNext = HEAP8[((textIndex+2)>>0)];
              if (nextNext == 108) {
                textIndex++;
                argSize = 8; // long long
              } else {
                argSize = 4; // long
              }
              break;
            case 'L': // long long
            case 'q': // int64_t
            case 'j': // intmax_t
              argSize = 8;
              break;
            case 'z': // size_t
            case 't': // ptrdiff_t
            case 'I': // signed ptrdiff_t or unsigned size_t
              argSize = 4;
              break;
            default:
              argSize = null;
          }
          if (argSize) textIndex++;
          next = HEAP8[((textIndex+1)>>0)];
  
          // Handle type specifier.
          switch (String.fromCharCode(next)) {
            case 'd': case 'i': case 'u': case 'o': case 'x': case 'X': case 'p': {
              // Integer.
              var signed = next == 100 || next == 105;
              argSize = argSize || 4;
              currArg = getNextArg('i' + (argSize * 8));
              var argText;
              // Flatten i64-1 [low, high] into a (slightly rounded) double
              if (argSize == 8) {
                currArg = makeBigInt(currArg[0], currArg[1], next == 117);
              }
              // Truncate to requested size.
              if (argSize <= 4) {
                var limit = Math.pow(256, argSize) - 1;
                currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
              }
              // Format the number.
              var currAbsArg = Math.abs(currArg);
              var prefix = '';
              if (next == 100 || next == 105) {
                argText = reSign(currArg, 8 * argSize, 1).toString(10);
              } else if (next == 117) {
                argText = unSign(currArg, 8 * argSize, 1).toString(10);
                currArg = Math.abs(currArg);
              } else if (next == 111) {
                argText = (flagAlternative ? '0' : '') + currAbsArg.toString(8);
              } else if (next == 120 || next == 88) {
                prefix = (flagAlternative && currArg != 0) ? '0x' : '';
                if (currArg < 0) {
                  // Represent negative numbers in hex as 2's complement.
                  currArg = -currArg;
                  argText = (currAbsArg - 1).toString(16);
                  var buffer = [];
                  for (var i = 0; i < argText.length; i++) {
                    buffer.push((0xF - parseInt(argText[i], 16)).toString(16));
                  }
                  argText = buffer.join('');
                  while (argText.length < argSize * 2) argText = 'f' + argText;
                } else {
                  argText = currAbsArg.toString(16);
                }
                if (next == 88) {
                  prefix = prefix.toUpperCase();
                  argText = argText.toUpperCase();
                }
              } else if (next == 112) {
                if (currAbsArg === 0) {
                  argText = '(nil)';
                } else {
                  prefix = '0x';
                  argText = currAbsArg.toString(16);
                }
              }
              if (precisionSet) {
                while (argText.length < precision) {
                  argText = '0' + argText;
                }
              }
  
              // Add sign if needed
              if (currArg >= 0) {
                if (flagAlwaysSigned) {
                  prefix = '+' + prefix;
                } else if (flagPadSign) {
                  prefix = ' ' + prefix;
                }
              }
  
              // Move sign to prefix so we zero-pad after the sign
              if (argText.charAt(0) == '-') {
                prefix = '-' + prefix;
                argText = argText.substr(1);
              }
  
              // Add padding.
              while (prefix.length + argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad) {
                    argText = '0' + argText;
                  } else {
                    prefix = ' ' + prefix;
                  }
                }
              }
  
              // Insert the result into the buffer.
              argText = prefix + argText;
              argText.split('').forEach(function(chr) {
                ret.push(chr.charCodeAt(0));
              });
              break;
            }
            case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
              // Float.
              currArg = getNextArg('double');
              var argText;
              if (isNaN(currArg)) {
                argText = 'nan';
                flagZeroPad = false;
              } else if (!isFinite(currArg)) {
                argText = (currArg < 0 ? '-' : '') + 'inf';
                flagZeroPad = false;
              } else {
                var isGeneral = false;
                var effectivePrecision = Math.min(precision, 20);
  
                // Convert g/G to f/F or e/E, as per:
                // http://pubs.opengroup.org/onlinepubs/9699919799/functions/printf.html
                if (next == 103 || next == 71) {
                  isGeneral = true;
                  precision = precision || 1;
                  var exponent = parseInt(currArg.toExponential(effectivePrecision).split('e')[1], 10);
                  if (precision > exponent && exponent >= -4) {
                    next = ((next == 103) ? 'f' : 'F').charCodeAt(0);
                    precision -= exponent + 1;
                  } else {
                    next = ((next == 103) ? 'e' : 'E').charCodeAt(0);
                    precision--;
                  }
                  effectivePrecision = Math.min(precision, 20);
                }
  
                if (next == 101 || next == 69) {
                  argText = currArg.toExponential(effectivePrecision);
                  // Make sure the exponent has at least 2 digits.
                  if (/[eE][-+]\d$/.test(argText)) {
                    argText = argText.slice(0, -1) + '0' + argText.slice(-1);
                  }
                } else if (next == 102 || next == 70) {
                  argText = currArg.toFixed(effectivePrecision);
                  if (currArg === 0 && __reallyNegative(currArg)) {
                    argText = '-' + argText;
                  }
                }
  
                var parts = argText.split('e');
                if (isGeneral && !flagAlternative) {
                  // Discard trailing zeros and periods.
                  while (parts[0].length > 1 && parts[0].indexOf('.') != -1 &&
                         (parts[0].slice(-1) == '0' || parts[0].slice(-1) == '.')) {
                    parts[0] = parts[0].slice(0, -1);
                  }
                } else {
                  // Make sure we have a period in alternative mode.
                  if (flagAlternative && argText.indexOf('.') == -1) parts[0] += '.';
                  // Zero pad until required precision.
                  while (precision > effectivePrecision++) parts[0] += '0';
                }
                argText = parts[0] + (parts.length > 1 ? 'e' + parts[1] : '');
  
                // Capitalize 'E' if needed.
                if (next == 69) argText = argText.toUpperCase();
  
                // Add sign.
                if (currArg >= 0) {
                  if (flagAlwaysSigned) {
                    argText = '+' + argText;
                  } else if (flagPadSign) {
                    argText = ' ' + argText;
                  }
                }
              }
  
              // Add padding.
              while (argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad && (argText[0] == '-' || argText[0] == '+')) {
                    argText = argText[0] + '0' + argText.slice(1);
                  } else {
                    argText = (flagZeroPad ? '0' : ' ') + argText;
                  }
                }
              }
  
              // Adjust case.
              if (next < 97) argText = argText.toUpperCase();
  
              // Insert the result into the buffer.
              argText.split('').forEach(function(chr) {
                ret.push(chr.charCodeAt(0));
              });
              break;
            }
            case 's': {
              // String.
              var arg = getNextArg('i8*');
              var argLength = arg ? _strlen(arg) : '(null)'.length;
              if (precisionSet) argLength = Math.min(argLength, precision);
              if (!flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }
              if (arg) {
                for (var i = 0; i < argLength; i++) {
                  ret.push(HEAPU8[((arg++)>>0)]);
                }
              } else {
                ret = ret.concat(intArrayFromString('(null)'.substr(0, argLength), true));
              }
              if (flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }
              break;
            }
            case 'c': {
              // Character.
              if (flagLeftAlign) ret.push(getNextArg('i8'));
              while (--width > 0) {
                ret.push(32);
              }
              if (!flagLeftAlign) ret.push(getNextArg('i8'));
              break;
            }
            case 'n': {
              // Write the length written so far to the next parameter.
              var ptr = getNextArg('i32*');
              HEAP32[((ptr)>>2)]=ret.length;
              break;
            }
            case '%': {
              // Literal percent sign.
              ret.push(curr);
              break;
            }
            default: {
              // Unknown specifiers remain untouched.
              for (var i = startTextIndex; i < textIndex + 2; i++) {
                ret.push(HEAP8[((i)>>0)]);
              }
            }
          }
          textIndex += 2;
          // TODO: Support a/A (hex float) and m (last error) specifiers.
          // TODO: Support %1${specifier} for arg selection.
        } else {
          ret.push(curr);
          textIndex += 1;
        }
      }
      return ret;
    }
  
  
  
  function __emscripten_traverse_stack(args) {
      if (!args || !args.callee || !args.callee.name) {
        return [null, '', ''];
      }
  
      var funstr = args.callee.toString();
      var funcname = args.callee.name;
      var str = '(';
      var first = true;
      for (var i in args) {
        var a = args[i];
        if (!first) {
          str += ", ";
        }
        first = false;
        if (typeof a === 'number' || typeof a === 'string') {
          str += a;
        } else {
          str += '(' + typeof a + ')';
        }
      }
      str += ')';
      var caller = args.callee.caller;
      args = caller ? caller.arguments : [];
      if (first)
        str = '';
      return [args, funcname, str];
    }
  
  function jsStackTrace() {
      var err = new Error();
      if (!err.stack) {
        // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
        // so try that as a special-case.
        try {
          throw new Error(0);
        } catch(e) {
          err = e;
        }
        if (!err.stack) {
          return '(no stack trace available)';
        }
      }
      return err.stack.toString();
    }
  
  function demangle(func) {
      var __cxa_demangle_func = Module['___cxa_demangle'] || Module['__cxa_demangle'];
      assert(__cxa_demangle_func);
      try {
        var s = func;
        if (s.startsWith('__Z'))
          s = s.substr(1);
        var len = lengthBytesUTF8(s)+1;
        var buf = _malloc(len);
        stringToUTF8(s, buf, len);
        var status = _malloc(4);
        var ret = __cxa_demangle_func(buf, 0, 0, status);
        if (HEAP32[((status)>>2)] === 0 && ret) {
          return UTF8ToString(ret);
        }
        // otherwise, libcxxabi failed
      } catch(e) {
        // ignore problems here
      } finally {
        if (buf) _free(buf);
        if (status) _free(status);
        if (ret) _free(ret);
      }
      // failure when using libcxxabi, don't demangle
      return func;
    }function _emscripten_get_callstack_js(flags) {
      var callstack = jsStackTrace();
  
      // Find the symbols in the callstack that corresponds to the functions that report callstack information, and remove everyhing up to these from the output.
      var iThisFunc = callstack.lastIndexOf('_emscripten_log');
      var iThisFunc2 = callstack.lastIndexOf('_emscripten_get_callstack');
      var iNextLine = callstack.indexOf('\n', Math.max(iThisFunc, iThisFunc2))+1;
      callstack = callstack.slice(iNextLine);
  
      // If user requested to see the original source stack, but no source map information is available, just fall back to showing the JS stack.
      if (flags & 8/*EM_LOG_C_STACK*/ && typeof emscripten_source_map === 'undefined') {
        warnOnce('Source map information is not available, emscripten_log with EM_LOG_C_STACK will be ignored. Build with "--pre-js $EMSCRIPTEN/src/emscripten-source-map.min.js" linker flag to add source map loading to code.');
        flags ^= 8/*EM_LOG_C_STACK*/;
        flags |= 16/*EM_LOG_JS_STACK*/;
      }
  
      var stack_args = null;
      if (flags & 128 /*EM_LOG_FUNC_PARAMS*/) {
        // To get the actual parameters to the functions, traverse the stack via the unfortunately deprecated 'arguments.callee' method, if it works:
        stack_args = __emscripten_traverse_stack(arguments);
        while (stack_args[1].indexOf('_emscripten_') >= 0)
          stack_args = __emscripten_traverse_stack(stack_args[0]);
      }
  
      // Process all lines:
      var lines = callstack.split('\n');
      callstack = '';
      var newFirefoxRe = new RegExp('\\s*(.*?)@(.*?):([0-9]+):([0-9]+)'); // New FF30 with column info: extract components of form '       Object._main@http://server.com:4324:12'
      var firefoxRe = new RegExp('\\s*(.*?)@(.*):(.*)(:(.*))?'); // Old FF without column info: extract components of form '       Object._main@http://server.com:4324'
      var chromeRe = new RegExp('\\s*at (.*?) \\\((.*):(.*):(.*)\\\)'); // Extract components of form '    at Object._main (http://server.com/file.html:4324:12)'
  
      for (var l in lines) {
        var line = lines[l];
  
        var jsSymbolName = '';
        var file = '';
        var lineno = 0;
        var column = 0;
  
        var parts = chromeRe.exec(line);
        if (parts && parts.length == 5) {
          jsSymbolName = parts[1];
          file = parts[2];
          lineno = parts[3];
          column = parts[4];
        } else {
          parts = newFirefoxRe.exec(line);
          if (!parts) parts = firefoxRe.exec(line);
          if (parts && parts.length >= 4) {
            jsSymbolName = parts[1];
            file = parts[2];
            lineno = parts[3];
            column = parts[4]|0; // Old Firefox doesn't carry column information, but in new FF30, it is present. See https://bugzilla.mozilla.org/show_bug.cgi?id=762556
          } else {
            // Was not able to extract this line for demangling/sourcemapping purposes. Output it as-is.
            callstack += line + '\n';
            continue;
          }
        }
  
        // Try to demangle the symbol, but fall back to showing the original JS symbol name if not available.
        var cSymbolName = (flags & 32/*EM_LOG_DEMANGLE*/) ? demangle(jsSymbolName) : jsSymbolName;
        if (!cSymbolName) {
          cSymbolName = jsSymbolName;
        }
  
        var haveSourceMap = false;
  
        if (flags & 8/*EM_LOG_C_STACK*/) {
          var orig = emscripten_source_map.originalPositionFor({line: lineno, column: column});
          haveSourceMap = (orig && orig.source);
          if (haveSourceMap) {
            if (flags & 64/*EM_LOG_NO_PATHS*/) {
              orig.source = orig.source.substring(orig.source.replace(/\\/g, "/").lastIndexOf('/')+1);
            }
            callstack += '    at ' + cSymbolName + ' (' + orig.source + ':' + orig.line + ':' + orig.column + ')\n';
          }
        }
        if ((flags & 16/*EM_LOG_JS_STACK*/) || !haveSourceMap) {
          if (flags & 64/*EM_LOG_NO_PATHS*/) {
            file = file.substring(file.replace(/\\/g, "/").lastIndexOf('/')+1);
          }
          callstack += (haveSourceMap ? ('     = '+jsSymbolName) : ('    at '+cSymbolName)) + ' (' + file + ':' + lineno + ':' + column + ')\n';
        }
  
        // If we are still keeping track with the callstack by traversing via 'arguments.callee', print the function parameters as well.
        if (flags & 128 /*EM_LOG_FUNC_PARAMS*/ && stack_args[0]) {
          if (stack_args[1] == jsSymbolName && stack_args[2].length > 0) {
            callstack = callstack.replace(/\s+$/, '');
            callstack += ' with values: ' + stack_args[1] + stack_args[2] + '\n';
          }
          stack_args = __emscripten_traverse_stack(stack_args[0]);
        }
      }
      // Trim extra whitespace at the end of the output.
      callstack = callstack.replace(/\s+$/, '');
      return callstack;
    }function _emscripten_log_js(flags, str) {
      if (flags & 24/*EM_LOG_C_STACK | EM_LOG_JS_STACK*/) {
        str = str.replace(/\s+$/, ''); // Ensure the message and the callstack are joined cleanly with exactly one newline.
        str += (str.length > 0 ? '\n' : '') + _emscripten_get_callstack_js(flags);
      }
  
      if (flags & 1 /*EM_LOG_CONSOLE*/) {
        if (flags & 4 /*EM_LOG_ERROR*/) {
          console.error(str);
        } else if (flags & 2 /*EM_LOG_WARN*/) {
          console.warn(str);
        } else {
          console.log(str);
        }
      } else if (flags & 6 /*EM_LOG_ERROR|EM_LOG_WARN*/) {
        err(str);
      } else {
        out(str);
      }
    }function _emscripten_log(flags, varargs) {
      // Extract the (optionally-existing) printf format specifier field from varargs.
      var format = HEAP32[((varargs)>>2)];
      varargs += 4;
      var str = '';
      if (format) {
        var result = __formatString(format, varargs);
        for(var i = 0 ; i < result.length; ++i) {
          str += String.fromCharCode(result[i]);
        }
      }
      _emscripten_log_js(flags, str);
    }

  function _emscripten_performance_now() {
      return performance.now();
    }

  function _emscripten_request_animation_frame_loop(cb, userData) {
      function tick(timeStamp) {
        if (dynCall_idi(cb, timeStamp, userData)) {
          requestAnimationFrame(tick);
        }
      }
      return requestAnimationFrame(tick);
    }

  
  var JSEvents={keyEvent:0,mouseEvent:0,wheelEvent:0,uiEvent:0,focusEvent:0,deviceOrientationEvent:0,deviceMotionEvent:0,fullscreenChangeEvent:0,pointerlockChangeEvent:0,visibilityChangeEvent:0,touchEvent:0,previousFullscreenElement:null,previousScreenX:null,previousScreenY:null,removeEventListenersRegistered:false,removeAllEventListeners:function() {
        for(var i = JSEvents.eventHandlers.length-1; i >= 0; --i) {
          JSEvents._removeHandler(i);
        }
        JSEvents.eventHandlers = [];
        JSEvents.deferredCalls = [];
      },deferredCalls:[],deferCall:function(targetFunction, precedence, argsList) {
        function arraysHaveEqualContent(arrA, arrB) {
          if (arrA.length != arrB.length) return false;
  
          for(var i in arrA) {
            if (arrA[i] != arrB[i]) return false;
          }
          return true;
        }
        // Test if the given call was already queued, and if so, don't add it again.
        for(var i in JSEvents.deferredCalls) {
          var call = JSEvents.deferredCalls[i];
          if (call.targetFunction == targetFunction && arraysHaveEqualContent(call.argsList, argsList)) {
            return;
          }
        }
        JSEvents.deferredCalls.push({
          targetFunction: targetFunction,
          precedence: precedence,
          argsList: argsList
        });
  
        JSEvents.deferredCalls.sort(function(x,y) { return x.precedence < y.precedence; });
      },removeDeferredCalls:function(targetFunction) {
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
            JSEvents.deferredCalls.splice(i, 1);
            --i;
          }
        }
      },canPerformEventHandlerRequests:function() {
        return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
      },runDeferredCalls:function() {
        if (!JSEvents.canPerformEventHandlerRequests()) {
          return;
        }
        for(var i = 0; i < JSEvents.deferredCalls.length; ++i) {
          var call = JSEvents.deferredCalls[i];
          JSEvents.deferredCalls.splice(i, 1);
          --i;
          call.targetFunction.apply(this, call.argsList);
        }
      },inEventHandler:0,currentEventHandler:null,eventHandlers:[],isInternetExplorer:function() { return navigator.userAgent.indexOf('MSIE') !== -1 || navigator.appVersion.indexOf('Trident/') > 0; },removeAllHandlersOnTarget:function(target, eventTypeString) {
        for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
          if (JSEvents.eventHandlers[i].target == target && 
            (!eventTypeString || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
             JSEvents._removeHandler(i--);
           }
        }
      },_removeHandler:function(i) {
        var h = JSEvents.eventHandlers[i];
        h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
        JSEvents.eventHandlers.splice(i, 1);
      },registerOrRemoveHandler:function(eventHandler) {
        var jsEventHandler = function jsEventHandler(event) {
          // Increment nesting count for the event handler.
          ++JSEvents.inEventHandler;
          JSEvents.currentEventHandler = eventHandler;
          // Process any old deferred calls the user has placed.
          JSEvents.runDeferredCalls();
          // Process the actual event, calls back to user C code handler.
          eventHandler.handlerFunc(event);
          // Process any new deferred calls that were placed right now from this event handler.
          JSEvents.runDeferredCalls();
          // Out of event handler - restore nesting count.
          --JSEvents.inEventHandler;
        }
        
        if (eventHandler.callbackfunc) {
          eventHandler.eventListenerFunc = jsEventHandler;
          eventHandler.target.addEventListener(eventHandler.eventTypeString, jsEventHandler, eventHandler.useCapture);
          JSEvents.eventHandlers.push(eventHandler);
        } else {
          for(var i = 0; i < JSEvents.eventHandlers.length; ++i) {
            if (JSEvents.eventHandlers[i].target == eventHandler.target
             && JSEvents.eventHandlers[i].eventTypeString == eventHandler.eventTypeString) {
               JSEvents._removeHandler(i--);
             }
          }
        }
      },getBoundingClientRectOrZeros:function(target) {
        return target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0 };
      },pageScrollPos:function() {
        if (pageXOffset > 0 || pageYOffset > 0) {
          return [pageXOffset, pageYOffset];
        }
        if (typeof document.documentElement.scrollLeft !== 'undefined' || typeof document.documentElement.scrollTop !== 'undefined') {
          return [document.documentElement.scrollLeft, document.documentElement.scrollTop];
        }
        return [document.body.scrollLeft|0, document.body.scrollTop|0];
      },getNodeNameForTarget:function(target) {
        if (!target) return '';
        if (target == window) return '#window';
        if (target == screen) return '#screen';
        return (target && target.nodeName) ? target.nodeName : '';
      },tick:function() {
        if (window['performance'] && window['performance']['now']) return window['performance']['now']();
        else return Date.now();
      },fullscreenEnabled:function() {
        return document.fullscreenEnabled || document.mozFullScreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
      }};
  
  
  
  function __maybeCStringToJsString(cString) {
      return cString === cString + 0 ? UTF8ToString(cString) : cString;
    }
  
  var __specialEventTargets=[0, document, window];function __findEventTarget(target) {
      var domElement = __specialEventTargets[target] || document.querySelector(__maybeCStringToJsString(target));
      // TODO: Remove this check in the future, or move it to some kind of debugging mode, because it may be perfectly fine behavior
      // for one to query an event target to test if any DOM element with given CSS selector exists. However for a migration period
      // from old lookup over to new, it is very useful to get diagnostics messages related to a lookup failing.
      if (!domElement) err('No DOM element was found with CSS selector "' + __maybeCStringToJsString(target) + '"');
      return domElement;
    }function __findCanvasEventTarget(target) { return __findEventTarget(target); }function _emscripten_set_canvas_element_size(target, width, height) {
      var canvas = __findCanvasEventTarget(target);
      if (!canvas) return -4;
      canvas.width = width;
      canvas.height = height;
      return 0;
    }

  
  var Fetch={xhrs:[],setu64:function(addr, val) {
      HEAPU32[addr >> 2] = val;
      HEAPU32[addr + 4 >> 2] = (val / 4294967296)|0;
    },staticInit:function() {
      var isMainThread = (typeof ENVIRONMENT_IS_FETCH_WORKER === 'undefined');
  
  
    }};
  
  function __emscripten_fetch_xhr(fetch, onsuccess, onerror, onprogress) {
    var url = HEAPU32[fetch + 8 >> 2];
    if (!url) {
      onerror(fetch, 0, 'no url specified!');
      return;
    }
    var url_ = UTF8ToString(url);
  
    var fetch_attr = fetch + 112;
    var requestMethod = UTF8ToString(fetch_attr);
    if (!requestMethod) requestMethod = 'GET';
    var userData = HEAPU32[fetch_attr + 32 >> 2];
    var fetchAttributes = HEAPU32[fetch_attr + 48 >> 2];
    var timeoutMsecs = HEAPU32[fetch_attr + 52 >> 2];
    var withCredentials = !!HEAPU32[fetch_attr + 56 >> 2];
    var destinationPath = HEAPU32[fetch_attr + 60 >> 2];
    var userName = HEAPU32[fetch_attr + 64 >> 2];
    var password = HEAPU32[fetch_attr + 68 >> 2];
    var requestHeaders = HEAPU32[fetch_attr + 72 >> 2];
    var overriddenMimeType = HEAPU32[fetch_attr + 76 >> 2];
    var dataPtr = HEAPU32[fetch_attr + 80 >> 2];
    var dataLength = HEAPU32[fetch_attr + 84 >> 2];
  
    var fetchAttrLoadToMemory = !!(fetchAttributes & 1);
    var fetchAttrStreamData = !!(fetchAttributes & 2);
    var fetchAttrAppend = !!(fetchAttributes & 8);
    var fetchAttrReplace = !!(fetchAttributes & 16);
    var fetchAttrSynchronous = !!(fetchAttributes & 64);
    var fetchAttrWaitable = !!(fetchAttributes & 128);
  
    var userNameStr = userName ? UTF8ToString(userName) : undefined;
    var passwordStr = password ? UTF8ToString(password) : undefined;
    var overriddenMimeTypeStr = overriddenMimeType ? UTF8ToString(overriddenMimeType) : undefined;
  
    var xhr = new XMLHttpRequest();
    xhr.withCredentials = withCredentials;
    xhr.open(requestMethod, url_, !fetchAttrSynchronous, userNameStr, passwordStr);
    if (!fetchAttrSynchronous) xhr.timeout = timeoutMsecs; // XHR timeout field is only accessible in async XHRs, and must be set after .open() but before .send().
    xhr.url_ = url_; // Save the url for debugging purposes (and for comparing to the responseURL that server side advertised)
    xhr.responseType = fetchAttrStreamData ? 'moz-chunked-arraybuffer' : 'arraybuffer';
  
    if (overriddenMimeType) {
      xhr.overrideMimeType(overriddenMimeTypeStr);
    }
    if (requestHeaders) {
      for(;;) {
        var key = HEAPU32[requestHeaders >> 2];
        if (!key) break;
        var value = HEAPU32[requestHeaders + 4 >> 2];
        if (!value) break;
        requestHeaders += 8;
        var keyStr = UTF8ToString(key);
        var valueStr = UTF8ToString(value);
        xhr.setRequestHeader(keyStr, valueStr);
      }
    }
    Fetch.xhrs.push(xhr);
    var id = Fetch.xhrs.length;
    HEAPU32[fetch + 0 >> 2] = id;
    var data = (dataPtr && dataLength) ? HEAPU8.slice(dataPtr, dataPtr + dataLength) : null;
    // TODO: Support specifying custom headers to the request.
  
    xhr.onload = function(e) {
      var len = xhr.response ? xhr.response.byteLength : 0;
      var ptr = 0;
      var ptrLen = 0;
      if (fetchAttrLoadToMemory && !fetchAttrStreamData) {
        ptrLen = len;
        // The data pointer malloc()ed here has the same lifetime as the emscripten_fetch_t structure itself has, and is
        // freed when emscripten_fetch_close() is called.
        ptr = _malloc(ptrLen);
        HEAPU8.set(new Uint8Array(xhr.response), ptr);
      }
      HEAPU32[fetch + 12 >> 2] = ptr;
      Fetch.setu64(fetch + 16, ptrLen);
      Fetch.setu64(fetch + 24, 0);
      if (len) {
        // If the final XHR.onload handler receives the bytedata to compute total length, report that,
        // otherwise don't write anything out here, which will retain the latest byte size reported in
        // the most recent XHR.onprogress handler.
        Fetch.setu64(fetch + 32, len);
      }
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      if (xhr.readyState === 4 && xhr.status === 0) {
        if (len > 0) xhr.status = 200; // If loading files from a source that does not give HTTP status code, assume success if we got data bytes.
        else xhr.status = 404; // Conversely, no data bytes is 404.
      }
      HEAPU16[fetch + 42 >> 1] = xhr.status;
      if (xhr.statusText) stringToUTF8(xhr.statusText, fetch + 44, 64);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onsuccess) onsuccess(fetch, xhr, e);
      } else {
        if (onerror) onerror(fetch, xhr, e);
      }
    }
    xhr.onerror = function(e) {
      var status = xhr.status; // XXX TODO: Overwriting xhr.status doesn't work here, so don't override anywhere else either.
      if (xhr.readyState == 4 && status == 0) status = 404; // If no error recorded, pretend it was 404 Not Found.
      HEAPU32[fetch + 12 >> 2] = 0;
      Fetch.setu64(fetch + 16, 0);
      Fetch.setu64(fetch + 24, 0);
      Fetch.setu64(fetch + 32, 0);
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      HEAPU16[fetch + 42 >> 1] = status;
      if (onerror) onerror(fetch, xhr, e);
    }
    xhr.ontimeout = function(e) {
      if (onerror) onerror(fetch, xhr, e);
    }
    xhr.onprogress = function(e) {
      var ptrLen = (fetchAttrLoadToMemory && fetchAttrStreamData && xhr.response) ? xhr.response.byteLength : 0;
      var ptr = 0;
      if (fetchAttrLoadToMemory && fetchAttrStreamData) {
        // The data pointer malloc()ed here has the same lifetime as the emscripten_fetch_t structure itself has, and is
        // freed when emscripten_fetch_close() is called.
        ptr = _malloc(ptrLen);
        HEAPU8.set(new Uint8Array(xhr.response), ptr);
      }
      HEAPU32[fetch + 12 >> 2] = ptr;
      Fetch.setu64(fetch + 16, ptrLen);
      Fetch.setu64(fetch + 24, e.loaded - ptrLen);
      Fetch.setu64(fetch + 32, e.total);
      HEAPU16[fetch + 40 >> 1] = xhr.readyState;
      if (xhr.readyState >= 3 && xhr.status === 0 && e.loaded > 0) xhr.status = 200; // If loading files from a source that does not give HTTP status code, assume success if we get data bytes
      HEAPU16[fetch + 42 >> 1] = xhr.status;
      if (xhr.statusText) stringToUTF8(xhr.statusText, fetch + 44, 64);
      if (onprogress) onprogress(fetch, xhr, e);
    }
    try {
      xhr.send(data);
    } catch(e) {
      if (onerror) onerror(fetch, xhr, e);
    }
  }
  
  
  var _fetch_work_queue=791200;function __emscripten_get_fetch_work_queue() {
      return _fetch_work_queue;
    }function _emscripten_start_fetch(fetch, successcb, errorcb, progresscb) {
    if (typeof Module !== 'undefined') Module['noExitRuntime'] = true; // If we are the main Emscripten runtime, we should not be closing down.
  
    var fetch_attr = fetch + 112;
    var requestMethod = UTF8ToString(fetch_attr);
    var onsuccess = HEAPU32[fetch_attr + 36 >> 2];
    var onerror = HEAPU32[fetch_attr + 40 >> 2];
    var onprogress = HEAPU32[fetch_attr + 44 >> 2];
    var fetchAttributes = HEAPU32[fetch_attr + 48 >> 2];
    var fetchAttrLoadToMemory = !!(fetchAttributes & 1);
    var fetchAttrStreamData = !!(fetchAttributes & 2);
    var fetchAttrAppend = !!(fetchAttributes & 8);
    var fetchAttrReplace = !!(fetchAttributes & 16);
  
    var reportSuccess = function(fetch, xhr, e) {
      if (onsuccess) dynCall_vi(onsuccess, fetch);
      else if (successcb) successcb(fetch);
    };
  
    var reportProgress = function(fetch, xhr, e) {
      if (onprogress) dynCall_vi(onprogress, fetch);
      else if (progresscb) progresscb(fetch);
    };
  
    var reportError = function(fetch, xhr, e) {
      if (onerror) dynCall_vi(onerror, fetch);
      else if (errorcb) errorcb(fetch);
    };
  
    var performUncachedXhr = function(fetch, xhr, e) {
      __emscripten_fetch_xhr(fetch, reportSuccess, reportError, reportProgress);
    };
  
    __emscripten_fetch_xhr(fetch, reportSuccess, reportError, reportProgress);
    return fetch;
  }

  function _emscripten_throw_string(str) {
      assert(typeof str === 'number');
      throw UTF8ToString(str);
    }

  
  
  var __emscripten_webgl_power_preferences=['default', 'low-power', 'high-performance'];function _emscripten_webgl_do_create_context(target, attributes) {
      assert(attributes);
      var contextAttributes = {};
      var a = attributes >> 2;
      contextAttributes['alpha'] = !!HEAP32[a + (0>>2)];
      contextAttributes['depth'] = !!HEAP32[a + (4>>2)];
      contextAttributes['stencil'] = !!HEAP32[a + (8>>2)];
      contextAttributes['antialias'] = !!HEAP32[a + (12>>2)];
      contextAttributes['premultipliedAlpha'] = !!HEAP32[a + (16>>2)];
      contextAttributes['preserveDrawingBuffer'] = !!HEAP32[a + (20>>2)];
      var powerPreference = HEAP32[a + (24>>2)];
      contextAttributes['powerPreference'] = __emscripten_webgl_power_preferences[powerPreference];
      contextAttributes['failIfMajorPerformanceCaveat'] = !!HEAP32[a + (28>>2)];
      contextAttributes.majorVersion = HEAP32[a + (32>>2)];
      contextAttributes.minorVersion = HEAP32[a + (36>>2)];
      contextAttributes.enableExtensionsByDefault = HEAP32[a + (40>>2)];
      contextAttributes.explicitSwapControl = HEAP32[a + (44>>2)];
      contextAttributes.proxyContextToMainThread = HEAP32[a + (48>>2)];
      contextAttributes.renderViaOffscreenBackBuffer = HEAP32[a + (52>>2)];
  
      var canvas = __findCanvasEventTarget(target);
  
  
  
      if (!canvas) {
        return 0;
      }
  
      if (contextAttributes.explicitSwapControl) {
        return 0;
      }
  
  
      var contextHandle = GL.createContext(canvas, contextAttributes);
      return contextHandle;
    }function _emscripten_webgl_create_context(a0,a1
  ) {
  return _emscripten_webgl_do_create_context(a0,a1);
  }

  
  function _emscripten_webgl_destroy_context_calling_thread(contextHandle) {
      if (GL.currentContext == contextHandle) GL.currentContext = 0;
      GL.deleteContext(contextHandle);
    }function _emscripten_webgl_destroy_context(a0
  ) {
  return _emscripten_webgl_destroy_context_calling_thread(a0);
  }

  function _emscripten_webgl_init_context_attributes(attributes) {
      assert(attributes);
      var a = attributes >> 2;
      for(var i = 0; i < (56>>2); ++i) {
        HEAP32[a+i] = 0;
      }
  
      HEAP32[a + (0>>2)] =
      HEAP32[a + (4>>2)] = 
      HEAP32[a + (12>>2)] = 
      HEAP32[a + (16>>2)] = 
      HEAP32[a + (32>>2)] = 
      HEAP32[a + (40>>2)] = 1;
  
    }

  function _emscripten_webgl_make_context_current(contextHandle) {
      var success = GL.makeContextCurrent(contextHandle);
      return success ? 0 : -5;
    }
  Module["_emscripten_webgl_make_context_current"] = _emscripten_webgl_make_context_current;

  function _exit(status) {
      throw 'exit(' + status + ')';
    }

  function _glActiveTexture(x0) { GLctx['activeTexture'](x0) }

  function _glAttachShader(program, shader) {
      GLctx.attachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _glBindBuffer(target, buffer) {
  
      if (target == 0x88EB /*GL_PIXEL_PACK_BUFFER*/) {
        // In WebGL 2 glReadPixels entry point, we need to use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_PACK_BUFFER_BINDING point, so must keep track whether that binding point is non-null to know what is
        // the proper API function to call.
        GLctx.currentPixelPackBufferBinding = buffer;
      } else if (target == 0x88EC /*GL_PIXEL_UNPACK_BUFFER*/) {
        // In WebGL 2 gl(Compressed)Tex(Sub)Image[23]D entry points, we need to
        // use a different WebGL 2 API function call when a buffer is bound to
        // GL_PIXEL_UNPACK_BUFFER_BINDING point, so must keep track whether that
        // binding point is non-null to know what is the proper API function to
        // call.
        GLctx.currentPixelUnpackBufferBinding = buffer;
      }
      GLctx.bindBuffer(target, GL.buffers[buffer]);
    }

  function _glBindFramebuffer(target, framebuffer) {
  
      GLctx.bindFramebuffer(target, GL.framebuffers[framebuffer]);
  
    }

  function _glBindRenderbuffer(target, renderbuffer) {
      GLctx.bindRenderbuffer(target, GL.renderbuffers[renderbuffer]);
    }

  function _glBindTexture(target, texture) {
      GLctx.bindTexture(target, GL.textures[texture]);
    }

  function _glBlendColor(x0, x1, x2, x3) { GLctx['blendColor'](x0, x1, x2, x3) }

  function _glBlendEquationSeparate(x0, x1) { GLctx['blendEquationSeparate'](x0, x1) }

  function _glBlendFuncSeparate(x0, x1, x2, x3) { GLctx['blendFuncSeparate'](x0, x1, x2, x3) }

  function _glBufferData(target, size, data, usage) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (data) {
          GLctx.bufferData(target, HEAPU8, usage, data, size);
        } else {
          GLctx.bufferData(target, size, usage);
        }
      } else {
        // N.b. here first form specifies a heap subarray, second form an integer size, so the ?: code here is polymorphic. It is advised to avoid
        // randomly mixing both uses in calling code, to avoid any potential JS engine JIT issues.
        GLctx.bufferData(target, data ? HEAPU8.subarray(data, data+size) : size, usage);
      }
    }

  function _glBufferSubData(target, offset, size, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.bufferSubData(target, offset, HEAPU8, data, size);
        return;
      }
      GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data+size));
    }

  function _glCheckFramebufferStatus(x0) { return GLctx['checkFramebufferStatus'](x0) }

  function _glClear(x0) { GLctx['clear'](x0) }

  function _glClearColor(x0, x1, x2, x3) { GLctx['clearColor'](x0, x1, x2, x3) }

  function _glClearDepthf(x0) { GLctx['clearDepth'](x0) }

  function _glClearStencil(x0) { GLctx['clearStencil'](x0) }

  function _glColorMask(red, green, blue, alpha) {
      GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
    }

  function _glCompileShader(shader) {
      GLctx.compileShader(GL.shaders[shader]);
    }

  function _glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, imageSize, data);
        } else {
          GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, HEAPU8, data, imageSize);
        }
        return;
      }
      GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, imageSize, data);
        } else {
          GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, HEAPU8, data, imageSize);
        }
        return;
      }
      GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, data ? HEAPU8.subarray((data),(data+imageSize)) : null);
    }

  function _glCreateProgram() {
      var id = GL.getNewId(GL.programs);
      var program = GLctx.createProgram();
      program.name = id;
      GL.programs[id] = program;
      return id;
    }

  function _glCreateShader(shaderType) {
      var id = GL.getNewId(GL.shaders);
      GL.shaders[id] = GLctx.createShader(shaderType);
      return id;
    }

  function _glCullFace(x0) { GLctx['cullFace'](x0) }

  function _glDeleteBuffers(n, buffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((buffers)+(i*4))>>2)];
        var buffer = GL.buffers[id];
  
        // From spec: "glDeleteBuffers silently ignores 0's and names that do not
        // correspond to existing buffer objects."
        if (!buffer) continue;
  
        GLctx.deleteBuffer(buffer);
        buffer.name = 0;
        GL.buffers[id] = null;
  
        if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
        if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
        if (id == GLctx.currentPixelPackBufferBinding) GLctx.currentPixelPackBufferBinding = 0;
        if (id == GLctx.currentPixelUnpackBufferBinding) GLctx.currentPixelUnpackBufferBinding = 0;
      }
    }

  function _glDeleteFramebuffers(n, framebuffers) {
      for (var i = 0; i < n; ++i) {
        var id = HEAP32[(((framebuffers)+(i*4))>>2)];
        var framebuffer = GL.framebuffers[id];
        if (!framebuffer) continue; // GL spec: "glDeleteFramebuffers silently ignores 0s and names that do not correspond to existing framebuffer objects".
        GLctx.deleteFramebuffer(framebuffer);
        framebuffer.name = 0;
        GL.framebuffers[id] = null;
      }
    }

  function _glDeleteProgram(id) {
      if (!id) return;
      var program = GL.programs[id];
      if (!program) { // glDeleteProgram actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteProgram(program);
      program.name = 0;
      GL.programs[id] = null;
      GL.programInfos[id] = null;
    }

  function _glDeleteRenderbuffers(n, renderbuffers) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((renderbuffers)+(i*4))>>2)];
        var renderbuffer = GL.renderbuffers[id];
        if (!renderbuffer) continue; // GL spec: "glDeleteRenderbuffers silently ignores 0s and names that do not correspond to existing renderbuffer objects".
        GLctx.deleteRenderbuffer(renderbuffer);
        renderbuffer.name = 0;
        GL.renderbuffers[id] = null;
      }
    }

  function _glDeleteShader(id) {
      if (!id) return;
      var shader = GL.shaders[id];
      if (!shader) { // glDeleteShader actually signals an error when deleting a nonexisting object, unlike some other GL delete functions.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      GLctx.deleteShader(shader);
      GL.shaders[id] = null;
    }

  function _glDeleteTextures(n, textures) {
      for (var i = 0; i < n; i++) {
        var id = HEAP32[(((textures)+(i*4))>>2)];
        var texture = GL.textures[id];
        if (!texture) continue; // GL spec: "glDeleteTextures silently ignores 0s and names that do not correspond to existing textures".
        GLctx.deleteTexture(texture);
        texture.name = 0;
        GL.textures[id] = null;
      }
    }

  function _glDepthFunc(x0) { GLctx['depthFunc'](x0) }

  function _glDepthMask(flag) {
      GLctx.depthMask(!!flag);
    }

  function _glDetachShader(program, shader) {
      GLctx.detachShader(GL.programs[program],
                              GL.shaders[shader]);
    }

  function _glDisable(x0) { GLctx['disable'](x0) }

  function _glDisableVertexAttribArray(index) {
      GLctx.disableVertexAttribArray(index);
    }

  function _glDrawArrays(mode, first, count) {
  
      GLctx.drawArrays(mode, first, count);
  
    }


  function _glEnable(x0) { GLctx['enable'](x0) }

  function _glEnableVertexAttribArray(index) {
      GLctx.enableVertexAttribArray(index);
    }

  function _glFlush() { GLctx['flush']() }

  function _glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
      GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget,
                                         GL.renderbuffers[renderbuffer]);
    }

  function _glFramebufferTexture2D(target, attachment, textarget, texture, level) {
      GLctx.framebufferTexture2D(target, attachment, textarget,
                                      GL.textures[texture], level);
    }

  function _glFrontFace(x0) { GLctx['frontFace'](x0) }

  function _glGenBuffers(n, buffers) {
      __glGenObject(n, buffers, 'createBuffer', GL.buffers
        );
    }

  function _glGenFramebuffers(n, ids) {
      __glGenObject(n, ids, 'createFramebuffer', GL.framebuffers
        );
    }

  function _glGenRenderbuffers(n, renderbuffers) {
      __glGenObject(n, renderbuffers, 'createRenderbuffer', GL.renderbuffers
        );
    }

  function _glGenTextures(n, textures) {
      __glGenObject(n, textures, 'createTexture', GL.textures
        );
    }

  function _glGenerateMipmap(x0) { GLctx['generateMipmap'](x0) }

  function _glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveAttrib(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size and type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _glGetActiveUniform(program, index, bufSize, length, size, type, name) {
      program = GL.programs[program];
      var info = GLctx.getActiveUniform(program, index);
      if (!info) return; // If an error occurs, nothing will be written to length, size, type and name.
  
      var numBytesWrittenExclNull = (bufSize > 0 && name) ? stringToUTF8(info.name, name, bufSize) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
      if (size) HEAP32[((size)>>2)]=info.size;
      if (type) HEAP32[((type)>>2)]=info.type;
    }

  function _glGetAttribLocation(program, name) {
      return GLctx.getAttribLocation(GL.programs[program], UTF8ToString(name));
    }

  function _glGetError() {
      // First return any GL error generated by the emscripten library_webgl.js interop layer.
      if (GL.lastError) {
        var error = GL.lastError;
        GL.lastError = 0/*GL_NO_ERROR*/;
        return error;
      } else
      { // If there were none, return the GL error from the browser GL context.
        return GLctx.getError();
      }
    }

  function _glGetFloatv(name_, p) {
      emscriptenWebGLGet(name_, p, 2);
    }

  function _glGetIntegerv(name_, p) {
      emscriptenWebGLGet(name_, p, 0);
    }

  function _glGetProgramInfoLog(program, maxLength, length, infoLog) {
      var log = GLctx.getProgramInfoLog(GL.programs[program]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetProgramiv(program, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      if (program >= GL.counter) {
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
  
      var ptable = GL.programInfos[program];
      if (!ptable) {
        GL.recordError(0x0502 /* GL_INVALID_OPERATION */);
        return;
      }
  
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getProgramInfoLog(GL.programs[program]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B87 /* GL_ACTIVE_UNIFORM_MAX_LENGTH */) {
        HEAP32[((p)>>2)]=ptable.maxUniformLength;
      } else if (pname == 0x8B8A /* GL_ACTIVE_ATTRIBUTE_MAX_LENGTH */) {
        if (ptable.maxAttributeLength == -1) {
          program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, 0x8B89/*GL_ACTIVE_ATTRIBUTES*/);
          ptable.maxAttributeLength = 0; // Spec says if there are no active attribs, 0 must be returned.
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxAttributeLength;
      } else if (pname == 0x8A35 /* GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH */) {
        if (ptable.maxUniformBlockNameLength == -1) {
          program = GL.programs[program];
          var numBlocks = GLctx.getProgramParameter(program, 0x8A36/*GL_ACTIVE_UNIFORM_BLOCKS*/);
          ptable.maxUniformBlockNameLength = 0;
          for (var i = 0; i < numBlocks; ++i) {
            var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
            ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length+1);
          }
        }
        HEAP32[((p)>>2)]=ptable.maxUniformBlockNameLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getProgramParameter(GL.programs[program], pname);
      }
    }

  function _glGetShaderInfoLog(shader, maxLength, length, infoLog) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (log === null) log = '(unknown error)';
      var numBytesWrittenExclNull = (maxLength > 0 && infoLog) ? stringToUTF8(log, infoLog, maxLength) : 0;
      if (length) HEAP32[((length)>>2)]=numBytesWrittenExclNull;
    }

  function _glGetShaderiv(shader, pname, p) {
      if (!p) {
        // GLES2 specification does not specify how to behave if p is a null pointer. Since calling this function does not make sense
        // if p == null, issue a GL error to notify user about it.
        GL.recordError(0x0501 /* GL_INVALID_VALUE */);
        return;
      }
      if (pname == 0x8B84) { // GL_INFO_LOG_LENGTH
        var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
        if (log === null) log = '(unknown error)';
        HEAP32[((p)>>2)]=log.length + 1;
      } else if (pname == 0x8B88) { // GL_SHADER_SOURCE_LENGTH
        var source = GLctx.getShaderSource(GL.shaders[shader]);
        var sourceLength = (source === null || source.length == 0) ? 0 : source.length + 1;
        HEAP32[((p)>>2)]=sourceLength;
      } else {
        HEAP32[((p)>>2)]=GLctx.getShaderParameter(GL.shaders[shader], pname);
      }
    }

  function _glGetString(name_) {
      if (GL.stringCache[name_]) return GL.stringCache[name_];
      var ret;
      switch(name_) {
        case 0x1F03 /* GL_EXTENSIONS */:
          var exts = GLctx.getSupportedExtensions();
          var gl_exts = [];
          for (var i = 0; i < exts.length; ++i) {
            gl_exts.push(exts[i]);
            gl_exts.push("GL_" + exts[i]);
          }
          ret = stringToNewUTF8(gl_exts.join(' '));
          break;
        case 0x1F00 /* GL_VENDOR */:
        case 0x1F01 /* GL_RENDERER */:
        case 0x9245 /* UNMASKED_VENDOR_WEBGL */:
        case 0x9246 /* UNMASKED_RENDERER_WEBGL */:
          var s = GLctx.getParameter(name_);
          if (!s) {
            GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          }
          ret = stringToNewUTF8(s);
          break;
  
        case 0x1F02 /* GL_VERSION */:
          var glVersion = GLctx.getParameter(GLctx.VERSION);
          // return GLES version string corresponding to the version of the WebGL context
          if (GL.currentContext.version >= 2) glVersion = 'OpenGL ES 3.0 (' + glVersion + ')';
          else
          {
            glVersion = 'OpenGL ES 2.0 (' + glVersion + ')';
          }
          ret = stringToNewUTF8(glVersion);
          break;
        case 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */:
          var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
          // extract the version number 'N.M' from the string 'WebGL GLSL ES N.M ...'
          var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
          var ver_num = glslVersion.match(ver_re);
          if (ver_num !== null) {
            if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + '0'; // ensure minor version has 2 digits
            glslVersion = 'OpenGL ES GLSL ES ' + ver_num[1] + ' (' + glslVersion + ')';
          }
          ret = stringToNewUTF8(glslVersion);
          break;
        default:
          GL.recordError(0x0500/*GL_INVALID_ENUM*/);
          return 0;
      }
      GL.stringCache[name_] = ret;
      return ret;
    }

  function _glGetUniformLocation(program, name) {
      name = UTF8ToString(name);
  
      var arrayIndex = 0;
      // If user passed an array accessor "[index]", parse the array index off the accessor.
      if (name[name.length - 1] == ']') {
        var leftBrace = name.lastIndexOf('[');
        arrayIndex = name[leftBrace+1] != ']' ? parseInt(name.slice(leftBrace + 1)) : 0; // "index]", parseInt will ignore the ']' at the end; but treat "foo[]" as "foo[0]"
        name = name.slice(0, leftBrace);
      }
  
      var uniformInfo = GL.programInfos[program] && GL.programInfos[program].uniforms[name]; // returns pair [ dimension_of_uniform_array, uniform_location ]
      if (uniformInfo && arrayIndex >= 0 && arrayIndex < uniformInfo[0]) { // Check if user asked for an out-of-bounds element, i.e. for 'vec4 colors[3];' user could ask for 'colors[10]' which should return -1.
        return uniformInfo[1] + arrayIndex;
      } else {
        return -1;
      }
    }

  function _glLinkProgram(program) {
      GLctx.linkProgram(GL.programs[program]);
      GL.populateUniformTable(program);
    }

  function _glPixelStorei(pname, param) {
      if (pname == 0x0cf5 /* GL_UNPACK_ALIGNMENT */) {
        GL.unpackAlignment = param;
      }
      GLctx.pixelStorei(pname, param);
    }

  function _glReadPixels(x, y, width, height, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelPackBufferBinding) {
          GLctx.readPixels(x, y, width, height, format, type, pixels);
        } else {
          GLctx.readPixels(x, y, width, height, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        }
        return;
      }
      var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
      if (!pixelData) {
        GL.recordError(0x0500/*GL_INVALID_ENUM*/);
        return;
      }
      GLctx.readPixels(x, y, width, height, format, type, pixelData);
    }

  function _glRenderbufferStorage(x0, x1, x2, x3) { GLctx['renderbufferStorage'](x0, x1, x2, x3) }

  function _glScissor(x0, x1, x2, x3) { GLctx['scissor'](x0, x1, x2, x3) }

  function _glShaderSource(shader, count, string, length) {
      var source = GL.getSource(shader, count, string, length);
  
  
      GLctx.shaderSource(GL.shaders[shader], source);
    }

  function _glStencilFuncSeparate(x0, x1, x2, x3) { GLctx['stencilFuncSeparate'](x0, x1, x2, x3) }

  function _glStencilOpSeparate(x0, x1, x2, x3) { GLctx['stencilOpSeparate'](x0, x1, x2, x3) }

  function _glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) {
        // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels);
        } else if (pixels != 0) {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        } else {
          GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, null);
        }
        return;
      }
      GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels ? emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) : null);
    }

  function _glTexParameterf(x0, x1, x2) { GLctx['texParameterf'](x0, x1, x2) }

  function _glTexParameterfv(target, pname, params) {
      var param = HEAPF32[((params)>>2)];
      GLctx.texParameterf(target, pname, param);
    }

  function _glTexParameteri(x0, x1, x2) { GLctx['texParameteri'](x0, x1, x2) }

  function _glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
      if (GL.currentContext.supportsWebGL2EntryPoints) {
        // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        if (GLctx.currentPixelUnpackBufferBinding) {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
        } else if (pixels != 0) {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, __heapObjectForWebGLType(type), pixels >> (__heapAccessShiftForWebGLType[type]|0));
        } else {
          GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, null);
        }
        return;
      }
      var pixelData = null;
      if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, 0);
      GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
    }

  function _glUniform1i(location, v0) {
      GLctx.uniform1i(GL.uniforms[location], v0);
    }

  function _glUniform1iv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform1iv(GL.uniforms[location], HEAP32, value>>2, count);
        return;
      }
  
      GLctx.uniform1iv(GL.uniforms[location], HEAP32.subarray((value)>>2,(value+count*4)>>2));
    }

  function _glUniform4fv(location, count, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniform4fv(GL.uniforms[location], HEAPF32, value>>2, count*4);
        return;
      }
  
      if (4*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[4*count-1];
        for (var i = 0; i < 4*count; i += 4) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*16)>>2);
      }
      GLctx.uniform4fv(GL.uniforms[location], view);
    }

  function _glUniformMatrix3fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*9);
        return;
      }
  
      if (9*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[9*count-1];
        for (var i = 0; i < 9*count; i += 9) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*36)>>2);
      }
      GLctx.uniformMatrix3fv(GL.uniforms[location], !!transpose, view);
    }

  function _glUniformMatrix4fv(location, count, transpose, value) {
  
      if (GL.currentContext.supportsWebGL2EntryPoints) { // WebGL 2 provides new garbage-free entry points to call to WebGL. Use those always when possible.
        GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, HEAPF32, value>>2, count*16);
        return;
      }
  
      if (16*count <= GL.MINI_TEMP_BUFFER_SIZE) {
        // avoid allocation when uploading few enough uniforms
        var view = GL.miniTempBufferViews[16*count-1];
        for (var i = 0; i < 16*count; i += 16) {
          view[i] = HEAPF32[(((value)+(4*i))>>2)];
          view[i+1] = HEAPF32[(((value)+(4*i+4))>>2)];
          view[i+2] = HEAPF32[(((value)+(4*i+8))>>2)];
          view[i+3] = HEAPF32[(((value)+(4*i+12))>>2)];
          view[i+4] = HEAPF32[(((value)+(4*i+16))>>2)];
          view[i+5] = HEAPF32[(((value)+(4*i+20))>>2)];
          view[i+6] = HEAPF32[(((value)+(4*i+24))>>2)];
          view[i+7] = HEAPF32[(((value)+(4*i+28))>>2)];
          view[i+8] = HEAPF32[(((value)+(4*i+32))>>2)];
          view[i+9] = HEAPF32[(((value)+(4*i+36))>>2)];
          view[i+10] = HEAPF32[(((value)+(4*i+40))>>2)];
          view[i+11] = HEAPF32[(((value)+(4*i+44))>>2)];
          view[i+12] = HEAPF32[(((value)+(4*i+48))>>2)];
          view[i+13] = HEAPF32[(((value)+(4*i+52))>>2)];
          view[i+14] = HEAPF32[(((value)+(4*i+56))>>2)];
          view[i+15] = HEAPF32[(((value)+(4*i+60))>>2)];
        }
      } else
      {
        var view = HEAPF32.subarray((value)>>2,(value+count*64)>>2);
      }
      GLctx.uniformMatrix4fv(GL.uniforms[location], !!transpose, view);
    }

  function _glUseProgram(program) {
      GLctx.useProgram(GL.programs[program]);
    }

  function _glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
      GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
    }

  function _glViewport(x0, x1, x2, x3) { GLctx['viewport'](x0, x1, x2, x3) }

  function _js_html_checkLoadImage(idx) {
      var img = ut._HTML.images[idx];
  
      if ( img.loaderror ) {
        return 2;
      }
  
      if (img.image) {
        if (!img.image.complete || !img.image.naturalWidth || !img.image.naturalHeight)
          return 0; // null - not yet loaded
      }
  
      if (img.mask) {
        if (!img.mask.complete || !img.mask.naturalWidth || !img.mask.naturalHeight)
          return 0; // null - not yet loaded
      }
  
      return 1; // ok
    }

  function _js_html_finishLoadImage(idx, wPtr, hPtr, alphaPtr) {
      var img = ut._HTML.images[idx];
      // check three combinations of mask and image
      if (img.image && img.mask) { // image and mask, merge mask into image 
        var width = img.image.naturalWidth;
        var height = img.image.naturalHeight;
        var maskwidth = img.mask.naturalWidth;
        var maskheight = img.mask.naturalHeight;
  
        // construct the final image
        var cvscolor = document.createElement('canvas');
        cvscolor.width = width;
        cvscolor.height = height;
        var cxcolor = cvscolor.getContext('2d');
        cxcolor.globalCompositeOperation = 'copy';
        cxcolor.drawImage(img.image, 0, 0);
  
        var cvsalpha = document.createElement('canvas');
        cvsalpha.width = width;
        cvsalpha.height = height;
        var cxalpha = cvsalpha.getContext('2d');
        cxalpha.globalCompositeOperation = 'copy';
        cxalpha.drawImage(img.mask, 0, 0, width, height);
  
        var colorBits = cxcolor.getImageData(0, 0, width, height);
        var alphaBits = cxalpha.getImageData(0, 0, width, height);
        var cdata = colorBits.data, adata = alphaBits.data;
        var sz = width * height;
        for (var i = 0; i < sz; i++)
          cdata[(i<<2) + 3] = adata[i<<2];
        cxcolor.putImageData(colorBits, 0, 0);
  
        img.image = cvscolor;
        img.image.naturalWidth = width;
        img.image.naturalHeight = height; 
        img.hasAlpha = true; 
      } else if (!img.image && img.mask) { // mask only, create image
        var width = img.mask.naturalWidth;
        var height = img.mask.naturalHeight;
  
        // construct the final image: copy R to all channels 
        var cvscolor = document.createElement('canvas');
        cvscolor.width = width;
        cvscolor.height = height;
        var cxcolor = cvscolor.getContext('2d');
        cxcolor.globalCompositeOperation = 'copy';
        cxcolor.drawImage(img.mask, 0, 0);
  
        var colorBits = cxcolor.getImageData(0, 0, width, height);
        var cdata = colorBits.data;
        var sz = width * height;
        for (var i = 0; i < sz; i++) {
          cdata[(i<<2) + 1] = cdata[i<<2];
          cdata[(i<<2) + 2] = cdata[i<<2];
          cdata[(i<<2) + 3] = cdata[i<<2];
        }
        cxcolor.putImageData(colorBits, 0, 0);
  
        img.image = cvscolor;
        img.image.naturalWidth = width;
        img.image.naturalHeight = height; 
        img.hasAlpha = true; 
      } // else img.image only, nothing else to do here
  
      // done, return valid size and hasAlpha
      HEAP32[wPtr>>2] = img.image.naturalWidth;
      HEAP32[hPtr>>2] = img.image.naturalHeight;
      HEAP32[alphaPtr>>2] = img.hasAlpha;
    }

  function _js_html_freeImage(idx) {
      ut._HTML.images[idx] = null;
    }

  function _js_html_getCanvasSize(wPtr, hPtr) {
      var html = ut._HTML;
      HEAP32[wPtr>>2] = html.canvasElement.width | 0;
      HEAP32[hPtr>>2] = html.canvasElement.height | 0;
    }

  function _js_html_getDPIScale() {
      return window.devicePixelRatio;
    }

  function _js_html_getFrameSize(wPtr, hPtr) {
      HEAP32[wPtr>>2] = window.innerWidth | 0;
      HEAP32[hPtr>>2] = window.innerHeight | 0;
    }

  function _js_html_getScreenSize(wPtr, hPtr) {
      HEAP32[wPtr>>2] = screen.width | 0;
      HEAP32[hPtr>>2] = screen.height | 0;
    }

  function _js_html_imageToMemory(idx, w, h, dest) {
      // TODO: there could be a fast(ish) path for webgl to get gl to directly write to
      // dest when reading from render targets
      var cvs = ut._HTML.readyCanvasForReadback(idx,w,h);
      if (!cvs)
        return 0;
      var cx = cvs.getContext('2d');
      var imd = cx.getImageData(0, 0, w, h);
      HEAPU8.set(imd.data,dest);
      return 1;
    }

  function _js_html_init() {
      ut = ut || {};
      ut._HTML = ut._HTML || {};
  
      var html = ut._HTML;
      html.visible = true;
      html.focused = true;
    }

  function _js_html_initImageLoading() {
      ut = ut || {};
      ut._HTML = ut._HTML || {};
  
      ut._HTML.images = [null];             // referenced by drawable, direct index to loaded image. maps 1:1 to Image2D component
                                      // { image, mask, loaderror, hasAlpha}
      ut._HTML.tintedSprites = [null];      // referenced by drawable, sub-sprite with colorization
                                      // { image, pattern }
      ut._HTML.tintedSpritesFreeList = [];
  
      // local helper functions
      ut._HTML.initImage = function(idx ) {
        ut._HTML.images[idx] = {
          image: null,
          mask: null,
          loaderror: false,
          hasAlpha: true,
          glTexture: null,
          glDisableSmoothing: false
        };
      };
  
      ut._HTML.ensureImageIsReadable = function (idx, w, h) {
        if (ut._HTML.canvasMode == 'webgl2' || ut._HTML.canvasMode == 'webgl') {
          var gl = ut._HTML.canvasContext;
          if (ut._HTML.images[idx].isrt) { // need to readback
            if (!ut._HTML.images[idx].glTexture)
              return false;
            // create fbo, read back bytes, write to image pixels
            var pixels = new Uint8Array(w*h*4);
            var fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ut._HTML.images[idx].glTexture, 0);
            gl.viewport(0,0,w,h);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)==gl.FRAMEBUFFER_COMPLETE) {
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            } else {
              console.log("Warning, can not read back from WebGL framebuffer.");
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.deleteFramebuffer(fbo);
              return false;
            }
            // restore default fbo
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            // put pixels onto an image
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var cx = canvas.getContext('2d');
            var imd = cx.createImageData(w, h);
            imd.data.set(pixels);
            cx.putImageData(imd,0,0);
            ut._HTML.images[idx].image = canvas;
            return true;
          }
        }
        if (ut._HTML.images[idx].isrt)
          return ut._HTML.images[idx].image && ut._HTML.images[idx].width==w && ut._HTML.images[idx].height==h;
        else
          return ut._HTML.images[idx].image && ut._HTML.images[idx].image.naturalWidth===w && ut._HTML.images[idx].image.naturalHeight===h;
      };
  
      ut._HTML.readyCanvasForReadback = function (idx, w, h) {
        if (!ut._HTML.ensureImageIsReadable(idx,w,h)) 
          return null;
        if (ut._HTML.images[idx].image instanceof HTMLCanvasElement) {
          // directly use canvas if the image is already a canvas (RTT case)
          return ut._HTML.images[idx].image;
        } else {
          // otherwise copy to a temp canvas
          var cvs = document.createElement('canvas');
          cvs.width = w;
          cvs.height = h;
          var cx = cvs.getContext('2d');
          var srcimg = ut._HTML.images[idx].image;
          cx.globalCompositeOperation = 'copy';
          cx.drawImage(srcimg, 0, 0, w, h);
          return cvs;
        }
      };
  
      ut._HTML.loadWebPFallback = function(url, idx) {
        function decode_base64(base64) {
          var size = base64.length;
          while (base64.charCodeAt(size - 1) == 0x3D)
            size--;
          var data = new Uint8Array(size * 3 >> 2);
          for (var c, cPrev = 0, s = 6, d = 0, b = 0; b < size; cPrev = c, s = s + 2 & 7) {
            c = base64.charCodeAt(b++);
            c = c >= 0x61 ? c - 0x47 : c >= 0x41 ? c - 0x41 : c >= 0x30 ? c + 4 : c == 0x2F ? 0x3F : 0x3E;
            if (s < 6)
              data[d++] = cPrev << 2 + s | c >> 4 - s;
          }
          return data;
        }
        if(!url)
          return false;
        if (!(typeof WebPDecoder == "object"))
          return false; // no webp fallback installed, let it fail on it's own
        if (WebPDecoder.nativeSupport)
          return false; // regular loading
        var webpCanvas;
        var webpPrefix = "data:image/webp;base64,";
        if (!url.lastIndexOf(webpPrefix, 0)) { // data url 
          webpCanvas = document.createElement("canvas");
          WebPDecoder.decode(decode_base64(url.substring(webpPrefix.length)), webpCanvas);
          webpCanvas.naturalWidth = webpCanvas.width;
          webpCanvas.naturalHeight = webpCanvas.height;
          webpCanvas.complete = true;
          ut._HTML.initImage(idx);
          ut._HTML.images[idx].image = webpCanvas;
          return true;
        }
        if (url.lastIndexOf("data:image/", 0) && url.match(/\.webp$/i)) {
          webpCanvas = document.createElement("canvas");
          webpCanvas.naturalWidth = 0;
          webpCanvas.naturalHeight = 0;
          webpCanvas.complete = false;
          ut._HTML.initImage(idx);
          ut._HTML.images[idx].image = webpCanvas;
          var webpRequest = new XMLHttpRequest();
          webpRequest.responseType = "arraybuffer";
          webpRequest.open("GET", url);
          webpRequest.onerror = function () {
            ut._HTML.images[idx].loaderror = true;
          };
          webpRequest.onload = function () {
            WebPDecoder.decode(new Uint8Array(webpRequest.response), webpCanvas);
            webpCanvas.naturalWidth = webpCanvas.width;
            webpCanvas.naturalHeight = webpCanvas.height;
            webpCanvas.complete = true;
          };
          webpRequest.send();
          return true;
        }
        return false; 
      };
  
    }

  function _js_html_loadImage(colorName, maskName) {
      colorName = colorName ? UTF8ToString(colorName) : null;
      maskName = maskName ? UTF8ToString(maskName) : null;
  
      // rewrite some special urls 
      if (colorName == "::white1x1") {
        colorName = "data:image/gif;base64,R0lGODlhAQABAIAAAP7//wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
      } else if (colorName && colorName.substring(0, 9) == "ut-asset:") {
        colorName = UT_ASSETS[colorName.substring(9)];
      }
      if (maskName && maskName.substring(0, 9) == "ut-asset:") {
        maskName = UT_ASSETS[maskName.substring(9)];
      }
  
      // grab first free index
      var idx;
      for (var i = 1; i <= ut._HTML.images.length; i++) {
        if (!ut._HTML.images[i]) {
          idx = i;
          break;
        }
      }
      ut._HTML.initImage(idx);
  
      // webp fallback if needed (extra special case)
      if (ut._HTML.loadWebPFallback(colorName, idx) )
        return idx;
  
      // start actual load
      if (colorName) {
        var imgColor = new Image();
        var isjpg = !!colorName.match(/\.jpe?g$/i);
        ut._HTML.images[idx].image = imgColor;
        ut._HTML.images[idx].hasAlpha = !isjpg;
        imgColor.onerror = function() { ut._HTML.images[idx].loaderror = true; };
        imgColor.src = colorName;
      }
  
      if (maskName) {
        var imgMask = new Image();
        ut._HTML.images[idx].mask = imgMask;
        ut._HTML.images[idx].hasAlpha = true;
        imgMask.onerror = function() { ut._HTML.images[idx].loaderror = true; };
        imgMask.src = maskName;
      }
  
      return idx; 
    }

  function _js_html_setCanvasSize(width, height, fbwidth, fbheight) {
      if (!width>0 || !height>0)
          throw "Bad canvas size at init.";
      var canvas = ut._HTML.canvasElement;
      if (!canvas) {
        // take possible user element
        canvas = document.getElementById("UT_CANVAS");
      }
      if (!canvas) {
        // Note -- if you change this here, make sure you also update
        // tiny_shell.html, which is where the default actually lives
        canvas = document.createElement("canvas");
        canvas.setAttribute("id", "UT_CANVAS");
        canvas.setAttribute("tabindex", "1");
        canvas.style.touchAction = "none";
        if (document.body) {
          document.body.style.margin = "0px";
          document.body.style.border = "0";
          document.body.style.overflow = "hidden"; // disable scrollbars
          document.body.style.display = "block";   // no floating content on sides
          document.body.insertBefore(canvas, document.body.firstChild);
        } else {
          document.documentElement.appendChild(canvas);
        }
      }
  
      ut._HTML.canvasElement = canvas;
  
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      canvas.width = fbwidth || width;
      canvas.height = fbheight || height;
  
      ut._HTML.canvasMode = 'bgfx';
  
      if (!canvas.tiny_initialized) {
        canvas.addEventListener("webglcontextlost", function(event) { event.preventDefault(); }, false);
        canvas.focus();
        canvas.tiny_initialized = true;
      }
  
      if (!window.tiny_initialized) {
        window.addEventListener("focus", function (event) { ut._HTML.focus = true; });
        window.addEventListener("blur", function (event) { ut._HTML.focus = false; });
        window.tiny_initialized = true;
      }
  
      return true;
    }

   

   

  function _llvm_bswap_i64(l, h) {
      var retl = _llvm_bswap_i32(h)>>>0;
      var reth = _llvm_bswap_i32(l)>>>0;
      return ((setTempRet0(reth),retl)|0);
    }

  function _llvm_trap() {
      abort('trap!');
    }

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

   

  
  function _usleep(useconds) {
      // int usleep(useconds_t useconds);
      // http://pubs.opengroup.org/onlinepubs/000095399/functions/usleep.html
      // We're single-threaded, so use a busy loop. Super-ugly.
      var msec = useconds / 1000;
      if ((ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self['performance'] && self['performance']['now']) {
        var start = self['performance']['now']();
        while (self['performance']['now']() - start < msec) {
          // Do nothing.
        }
      } else {
        var start = Date.now();
        while (Date.now() - start < msec) {
          // Do nothing.
        }
      }
      return 0;
    }function _nanosleep(rqtp, rmtp) {
      // int nanosleep(const struct timespec  *rqtp, struct timespec *rmtp);
      var seconds = HEAP32[((rqtp)>>2)];
      var nanoseconds = HEAP32[(((rqtp)+(4))>>2)];
      if (rmtp !== 0) {
        HEAP32[((rmtp)>>2)]=0;
        HEAP32[(((rmtp)+(4))>>2)]=0;
      }
      return _usleep((seconds * 1e6) + (nanoseconds / 1000));
    }

  
  function _emscripten_get_heap_size() {
      return TOTAL_MEMORY;
    }
  
  function _emscripten_resize_heap(requestedSize) {
      return false; // malloc will report failure
    } 
if (typeof dateNow !== 'undefined') {
    _emscripten_get_now = dateNow;
  } else if (typeof performance === 'object' && performance && typeof performance['now'] === 'function') {
    _emscripten_get_now = function() { return performance['now'](); };
  } else {
    _emscripten_get_now = Date.now;
  };
var GLctx; GL.init();
for (var i = 0; i < 32; i++) __tempFixedLengthArray.push(new Array(i));;
Fetch.staticInit();;
var ut;;
// ASM_LIBRARY EXTERN PRIMITIVES: Int8Array,Int32Array

var debug_table_fi = [0,'_Enumerator_get_Current_mE0EE0CBDD6A2F2AD152456BFB7F4BBC134E2F9AF_AdjustorThunk','_Enumerator_get_Current_mB658ED8B511822B51B4A84CFA775C8B1A8BA3F16_AdjustorThunk','_Enumerator_get_Current_m5009B6B666050D3D33276AF4925B9E564587FD9D_AdjustorThunk'];
var debug_table_i = [0,'_RunLoopImpl_ManagedRAFCallback_mF925FE255AA713688A997187358E933BB3C01E3E','_ReversePInvokeWrapper_RunLoopImpl_ManagedRAFCallback_mF925FE255AA713688A997187358E933BB3C01E3E','_GC_never_stop_func','_GC_timeout_stop_func','_emscripten_glCreateProgram','_emscripten_glGetError',0];
var debug_table_idi = [0,'__ZL4tickdPv'];
var debug_table_ii = [0,'_ValueType_GetHashCode_m1B6B51019DE497F4593F85245565A083D8EC5ECC','_Object_ToString_m2F8E1D9C39999F582E7E3FB8C25BDE64CF5D3FB1','_Object_GetHashCode_m0124B0EA741D727FB7F634BE12BD76B09AB61539','_String_GetHashCode_m92B35EDBE7FDC54BFC0D7189F66AB9BEB8A448D6','_String_ToString_mB0D08BCA549F28AB02BF4172734FA03CEE10BDEF','_Boolean_ToString_m21623BAD041ACEB9C6D1D518CEC0557836BFEB3E_AdjustorThunk','_Int32_GetHashCode_mBA6D17ACDEA463332E5BEE01CFBF7655565F68AB_AdjustorThunk','_Int32_ToString_mD4F198CBC9F482089B366CC486A2AE940001E541_AdjustorThunk','_Char_ToString_mB436886BB2D2CAA232BD6EDFDEBC80F1D8167793_AdjustorThunk','_Double_ToString_mCF8636E87D2E7380DC9D87F9D65814787A1A9641_AdjustorThunk','_UInt32_GetHashCode_mEE25741A74BF35F40D9ECE923222F0F9154E55C2_AdjustorThunk','_UInt32_ToString_mC9C8805EFE6AD403867D30A7364F053E1502908A_AdjustorThunk','_UInt64_GetHashCode_m04995EC62B0C691D5E18267BA59AA04C2C274430_AdjustorThunk','_UInt64_ToString_mC13424681BDC2B62B25ED921557409A1050D00E2_AdjustorThunk','_Type_ToString_m40E1B66CB7DE4E17EE80ED913F8B3BF2243D45F1','_Guid_GetHashCode_m170444FA149D326105F600B729382AF93F2B6CA8_AdjustorThunk','_Guid_ToString_mD0E5721450AAD1387B5E499100EDF9BB9C693E0B_AdjustorThunk','_IntPtr_GetHashCode_m7CFD7A67C9A53C3426144DA5598C2EA98F835C23_AdjustorThunk','_IntPtr_ToString_mA58A6598C07EBC1767491778D67AAB380087F0CE_AdjustorThunk','_Enum_GetHashCode_mC40D81C4EE4A29E14298917C31AAE528484F40BE','_SByte_GetHashCode_m718B3B67E8F7981E0ED0FA754EAB2B5F4A8CFB02_AdjustorThunk','_SByte_ToString_m1206C37C461F0FCB10FB91C43D8DB91D0C66ADAE_AdjustorThunk','_Byte_GetHashCode_mA72B81DA9F4F199178D47432C6603CCD085D91A1_AdjustorThunk','_Byte_ToString_m763404424D28D2AEBAF7FAA8E8F43C3D43E42168_AdjustorThunk','_Int16_GetHashCode_mF465E7A7507982C0E10B76B1939D5D41263DD915_AdjustorThunk','_Int16_ToString_m7597E80D8DB820851DAFD6B43576038BF1E7AC54_AdjustorThunk','_UInt16_GetHashCode_mE8455222B763099240A09D3FD4EE53E29D3CFE41_AdjustorThunk','_UInt16_ToString_m04992F7C6340EB29110C3B2D3F164171D8F284F2_AdjustorThunk','_Int64_GetHashCode_m20E61A76FF573C96FE099C614286B4CDB6BEDDDC_AdjustorThunk','_Int64_ToString_m4FDD791C91585CC95610C5EA5FCCE3AD876BFEB1_AdjustorThunk','_UIntPtr_GetHashCode_m559E8D42D8CF37625EE6D0C3C26B951861EE67E7_AdjustorThunk','_UIntPtr_ToString_m81189D03BA57F753DEEE60CB9D7DE8F4829EEA65_AdjustorThunk','_Single_ToString_mF63119C000259A5CA0471466393D5F5940748EC4_AdjustorThunk','_bool4_GetHashCode_m937BB6FB351DAEFF64CC8B03E9A45F52EECD778A_AdjustorThunk','_bool4_ToString_m1EFC2F937BFB00EA4A7198CF458DD230CC3CEDAA_AdjustorThunk','_float2_GetHashCode_mA948401C52CE935D4AABCC4B0455B14C6DFFCD16_AdjustorThunk','_float2_ToString_m481DE2F7B756D63F85C5093E6DDB16AD5F179941_AdjustorThunk','_float4_GetHashCode_m25D29A72C5E2C21EE21B4940E9825113EA06CFAB_AdjustorThunk','_float4_ToString_m4B13F8534AC224BDFDB905FE309BC94D4A439C20_AdjustorThunk','_float3_GetHashCode_mC6CE65E980EC31CF3E63A0B83F056036C87498EC_AdjustorThunk','_float3_ToString_mFD939AC9FF050E0B5B8057F2D4CD64414A3286B3_AdjustorThunk','_float3x3_GetHashCode_m65A70424340A807965D04BC5104E0723509392C2_AdjustorThunk','_float3x3_ToString_m9B4217D00C44574E76BBCD01DD4CC02C90133684_AdjustorThunk','_uint3_GetHashCode_mC5C0B806919339B0F1E061BF04A4682943820A70_AdjustorThunk','_uint3_ToString_m17D60A96B38038168016152EAA429A08F26A5112_AdjustorThunk','_float4x4_GetHashCode_m41EA5B94472BCBCF17AFBAAF4E73536AA0CC8352_AdjustorThunk','_float4x4_ToString_mC1AE444284D042813DFFFEA72196C651C8741EBC_AdjustorThunk','_uint4_GetHashCode_m0239AEED2EE7540408472027E6534DAE58D016A8_AdjustorThunk','_uint4_ToString_m520C4C7062B544A4B8BB3C85357459B60B2A002B_AdjustorThunk','_uint2_GetHashCode_m64224B108E7424EDDF94F6113D2A058F64F916D9_AdjustorThunk','_uint2_ToString_mC62FCF92B92133B0812E05044B5937B54D1F6C29_AdjustorThunk','_quaternion_GetHashCode_m53775A9F474E2E5EA3311EAC10B54A3F0BACFDDD_AdjustorThunk','_quaternion_ToString_m7E0B020C681C1A89561CF0204D5959557A5B15F2_AdjustorThunk','_FixedListByte32_GetHashCode_m7B995E66626B8506C6DB1B92D90313E59A75D63A_AdjustorThunk','_FixedListByte32_System_Collections_Generic_IEnumerableU3CSystem_ByteU3E_GetEnumerator_mE593DE63377657215AE8628A0481ED088B29568E_AdjustorThunk','_FixedListByte64_GetHashCode_mD8960B1B457335FDD66BEBC3E076D86D83CBA8CC_AdjustorThunk','_FixedListByte64_System_Collections_Generic_IEnumerableU3CSystem_ByteU3E_GetEnumerator_mAD801886F244EBF8367BCA687E84C8DC304E60C3_AdjustorThunk','_FixedListByte128_GetHashCode_mC8C5F4B73BDEFC2AB56D8175BB456F5B33A64D0C_AdjustorThunk','_FixedListByte128_System_Collections_Generic_IEnumerableU3CSystem_ByteU3E_GetEnumerator_m7F57D1CB1E56CAAAF324A7A8603BB4CECFE8C811_AdjustorThunk','_FixedListByte512_GetHashCode_m81B51C4D07B8D362DDCD57569E914B6F1EF7B37F_AdjustorThunk','_FixedListByte512_System_Collections_Generic_IEnumerableU3CSystem_ByteU3E_GetEnumerator_mB9F72A3FAF7F8F1E673D22B030C420F67B948DD9_AdjustorThunk','_FixedListByte4096_GetHashCode_mA33AF5CBA14706826BF42B902482650DAE55242A_AdjustorThunk','_FixedListByte4096_System_Collections_Generic_IEnumerableU3CSystem_ByteU3E_GetEnumerator_m9C5F65CC26C9BAC90C8051E5A00FC5909DB63D68_AdjustorThunk','_FixedListInt32_GetHashCode_m3AE842B7E17D5917B7B8164CF9A286C796A05603_AdjustorThunk','_FixedListInt32_System_Collections_Generic_IEnumerableU3CSystem_Int32U3E_GetEnumerator_m9B0F7C691FE2649935D82E6AD3226A1670894F51_AdjustorThunk','_FixedListInt64_GetHashCode_m39C5638B6C381703248B3A45F5C8EA9C48F3884B_AdjustorThunk','_FixedListInt64_System_Collections_Generic_IEnumerableU3CSystem_Int32U3E_GetEnumerator_m54D4440886BC15CC08304DB3C90B060D137EDB3E_AdjustorThunk','_FixedListInt128_GetHashCode_m66991AC4057EAA2A99A7F50D9596E2B5D43DCCAA_AdjustorThunk','_FixedListInt128_System_Collections_Generic_IEnumerableU3CSystem_Int32U3E_GetEnumerator_m14E10C75CFBAFC85C5B02B0D2915CCA5CEF11AA2_AdjustorThunk','_FixedListInt512_GetHashCode_mEA0392B1E8652D55FFA026823D9E7D48FD767A6E_AdjustorThunk','_FixedListInt512_System_Collections_Generic_IEnumerableU3CSystem_Int32U3E_GetEnumerator_m2A85286F1E3C9752DE017C26810F71202209A4E2_AdjustorThunk','_FixedListInt4096_GetHashCode_m61B3FAD28FD24611DDEDAB752A08222C2746677A_AdjustorThunk','_FixedListInt4096_System_Collections_Generic_IEnumerableU3CSystem_Int32U3E_GetEnumerator_m3D833C405D6CE095210F5318CBCE771F87FC2805_AdjustorThunk','_NativeString512_GetHashCode_m87C2382927D6F6DC38B9ADA5A73D883C3C998DC6_AdjustorThunk','_NativeString512_ToString_m7410A5AF5412A5C9EB58AE5FC722320698CC9C00_AdjustorThunk','_Color_GetHashCode_mA50245CD9DE9C30C9D59CD665E6EE38616E4A8D9_AdjustorThunk','_Entity_GetHashCode_mCD1B382965923B4D8F9D5F8D3487567046E4421B_AdjustorThunk','_Entity_ToString_mD13D1E96A001C26F7B67E5A9EE4CDA2583C8395E_AdjustorThunk','_ComponentType_GetHashCode_mAA4F2ECFF4A9D241BE8D1F246E8D96750F3C9F86_AdjustorThunk','_ComponentType_ToString_m592DDA2FC9006F7BE2FAE8ADA48A4005B3B188DD_AdjustorThunk','_NativeArray_1_GetHashCode_mC76FBB24CD1273D78281A7AA427C3BCCB50E04F4_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEFA4DC08A85BA929FDEC8F4E67FED14D16B65EB5_AdjustorThunk','_AABB_ToString_mF99D24B9478C79AEEFD9CA4281643665AA831893_AdjustorThunk','_EntityQueryBuilder_GetHashCode_mB055AB1BF3D95524DF70793120D07E95E09CDBD3_AdjustorThunk','_NativeArray_1_GetHashCode_m0DB13C0C977BFB9108F3EEE50324032BA51DF347_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m1EED345B0A23E52F9CE98C9281F072649CDCF3E6_AdjustorThunk','_Scene_GetHashCode_m5E6729A8B6DB615771A604CE9FF09EDD44A909E6_AdjustorThunk','_SceneGuid_GetHashCode_m948EDA30482D4DB87F134CB308708CAEA3E4406C_AdjustorThunk','_World_ToString_mADB17B409AF3FFB43A4371D353B89FBD49507B48','_AsyncOp_ToString_mC51C841EF91AB2756867CF0FBD7292C3479FC037_AdjustorThunk','_Connection_get_Peer_m4A46D70562D78FD87F382ADE3018F387B81BC40A_AdjustorThunk','_Connection_get_RemoteId_m2F6F80AF3AFF8938AABD53C10E19C32B8A44EA27_AdjustorThunk','_EntityGuid_GetHashCode_mEF4B9EB71BD66A885943D0A0F5F30E6C65664F92_AdjustorThunk','_EntityGuid_ToString_m1621A722F1F0EC56D449EADCF0096C16E957D18A_AdjustorThunk','_SceneReference_GetHashCode_mC88DAA73E134CDA559B2D8FC255886405619F1F2_AdjustorThunk','_SceneTag_GetHashCode_m4A71390201A1FB19A53E17880D8AF679BD5AB9A5_AdjustorThunk','_SceneTag_ToString_m39DF9A31846A9D97D4879B8BB98A7EB56CC82C67_AdjustorThunk','_SceneSection_GetHashCode_m56EF3A1C2B91DAEF5960F137F2E34490E632F25C_AdjustorThunk','_BuildGroup_GetHashCode_mA12C67D00499BADABA775C0F141C181726A9F39D_AdjustorThunk','_HTMLWindowSystem_GetPlatformWindowHandle_mCBF33C0F67E020CC84427EF54153BF4FC4ECDFCB','_EntityArchetype_GetHashCode_mA1006937A388D62CD9C4DCC150591B0054775D2A_AdjustorThunk','_ComponentTypeInArchetype_GetHashCode_m60FF085A6DAE0D57C5AE8754D5F3150A50824AC5_AdjustorThunk','_ComponentTypeInArchetype_ToString_m62029984A20006D13CE76BCD8E713592DCE5736D_AdjustorThunk','_ArchetypeChunk_GetHashCode_mA09F0D726007722DCBD42C8953CFFC812FDCD4CD_AdjustorThunk','_BlobAssetPtr_GetHashCode_mEC1FA28CD57BA4C429EF19048ADD27E515EE44C1_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7ECAF2948AC395B2A3FE4400F954D6EBAD378D3B','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0199D925316F3CB20E2B826C2D3FA0476A3D1289','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m6BA804CDD54E979FBA8500408D4118EAB7827FB3','_NativeArray_1_GetHashCode_mFEB349DE9C7266D55C8BA36C54A298A762DF9620_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m625C56C9A3A01EE476E680AEA0275BA086467789_AdjustorThunk','_NativeArray_1_GetHashCode_mFD890898CF9235360D31A7278664D98423B063FD_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m04FD6C6B45898ABA4004D15A36A4764F05B45B7C_AdjustorThunk','_NativeList_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB3EAC886C2152612D0F698CBD05BCDAB9E19284B_AdjustorThunk','_Hash128_GetHashCode_mD7F8986BC81FC06E2F5FF3592E978DD7706DF58B_AdjustorThunk','_Hash128_ToString_m320D31CB2D976B1B82831D17330FE957E87A344E_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE6333C0121B84CFE885D3B1DB7CFEE6D9F3A3B54','_NativeArray_1_GetHashCode_m4966C5CCD58C3CA0EEAF30FCCE09FB9CF2203A37_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m40AD332B96C4862F6ADDA0B10153F4B1D48AA067_AdjustorThunk','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA71ACADA628241B7687DF5A3B6C6CC8198947AA0','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEE1A5EFA3E284AF3E8A0ED26A0A12216D8C5CD17','_List_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0AC84C041C074AABC70B72C311F55324D2DF6495','_RunLoopDelegate_Invoke_mB498A417DD5ABD7B53FD64D45953F34DEA48E173','_Enumerator_get_Current_mFB87ADAC2B88B4FC962999A7991497ABB2DE0B3B_AdjustorThunk','_Enumerator_MoveNext_mCF29112702297DA4897A92513CDB1180B66EB43A_AdjustorThunk','_Enumerator_get_Current_m73F6908B1C85CAF0AAA4482E34C5E4FB88CB6226_AdjustorThunk','_Enumerator_MoveNext_mB496DF87EB078B9069267F641D50CA97CAE09461_AdjustorThunk','_Enumerator_get_Current_m8F6F867D505A5C549B549E5F7385223F245824CB_AdjustorThunk','_Enumerator_MoveNext_mD114CEB68F7A60A181D3959982B54AEC59F63160_AdjustorThunk','_Enumerator_get_Current_mD19CB373028DF9ED0B073BBAD4D2102F85745291_AdjustorThunk','_Enumerator_MoveNext_mBC614844377085D8D66A91E7301A02C4357D9D2E_AdjustorThunk','_Enumerator_MoveNext_m802D6F6C750B08E3061672D81E158203290842DA_AdjustorThunk','_Enumerator_MoveNext_m4A5C1777E3A4E491D58EE9B34B25AEA40ECEC74A_AdjustorThunk','_Enumerator_get_Current_m5761080B16D69E17C668CCD263D3173B11DDC6DC_AdjustorThunk','_Enumerator_MoveNext_mEC2C2490AC554887909C9B6E50EFBD51759FB66F_AdjustorThunk','_Enumerator_get_Current_m228E7B60E514483F72C70856C5AB44BE2E2D0A36_AdjustorThunk','_Enumerator_MoveNext_mB6D8761D0655224E293B9D462E6611F227AB2A6B_AdjustorThunk','_NativeArray_1_GetHashCode_m0D1D5019BF66CAD007B84064F3CDB2D69C0888F3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mCD787823DBFBF076490B4B3C1EF05DD574CCB78D_AdjustorThunk','_Enumerator_get_Current_mC4547F50A41928D333617D032973289AF4E5204B_AdjustorThunk','_Enumerator_MoveNext_m9A2AE49D3675A14AAD78F1534BAB812D40E60003_AdjustorThunk','_NativeArray_1_GetHashCode_m10806976ACA31A415C7F48618F8101C1B97BFED2_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5DE50E4D1FFEA4E64BD54D8470A6060BAF98AA28_AdjustorThunk','_Enumerator_get_Current_mFF80482AFBB7A21AE57204DE1CF549B2C253D651_AdjustorThunk','_Enumerator_MoveNext_m024EAED6AF42B7883E66FF40591F74C9A60FBB08_AdjustorThunk','_Enumerator_get_Current_m1AD73A657D7B705B01461D5E73757D2C8B62A87A_AdjustorThunk','_Enumerator_MoveNext_m00E75A617196E4990F84C085DC6FC3006B730062_AdjustorThunk','_NativeArray_1_GetHashCode_mE9F0C432A12C17DCB7542670BCE97AA73F29181C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7514B77B2C447797CB5A64A5155A3E4F4FF12233_AdjustorThunk','_Enumerator_MoveNext_m7BBFD970FB8DCCF7500BE762A2F328AA91C3E645_AdjustorThunk','_NativeArray_1_GetHashCode_m27C3DECFC4B1BD6E506B6810B4DF050C360C8EB9_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5236F10BF7F28EF06513F7E4CFB94A3FB65FFF52_AdjustorThunk','_Enumerator_MoveNext_m9EBB1020E59CE6531D6BAE5776D64F01E73592FF_AdjustorThunk','_NativeArray_1_GetHashCode_m046207D9884C4DCE9AC88C8C62F2C1CEC4E73093_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC65B5625C5C5362CF957EE2EB3B36A4430DB38CE_AdjustorThunk','_Enumerator_MoveNext_mBF717E9C5A38C7F5F3585D4C1403B19300B7960C_AdjustorThunk','_Enumerator_MoveNext_m5F8619203D4872B1E0C80AED3E700B78D014C8D2_AdjustorThunk','_NativeArray_1_GetHashCode_mC0F0669424822ED96181D81B1B1DE6C3D5C519D3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0E1C4E2A887018F85190ECC44EF1B6BAFC569004_AdjustorThunk','_Enumerator_MoveNext_m46A8DA06205EA5FBE9C50544CC4B18A701BD7EAC_AdjustorThunk','_NativeArray_1_GetHashCode_m28EBA687533E6A283F82817C099FDCA72B223B18_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB81E6D0B9E328ED5E1D1D021C9CE954420552CCD_AdjustorThunk','_Enumerator_MoveNext_m527BD14C255F63FA44086AC1C13F19E7AD179217_AdjustorThunk','_Enumerator_MoveNext_m4256FBE26BC283A0E66E428A7F51CD155025FBFE_AdjustorThunk','_Enumerator_MoveNext_m478C96CD7A31BBAE599B699F1332C3C6A4168ED4_AdjustorThunk','_NativeArray_1_GetHashCode_m6C126C524D290AD5CEF02957ECEC003D66D6A965_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m6E56A9A47945A0B8F28DEE1415AC92DB907AC481_AdjustorThunk','_Enumerator_MoveNext_m3E36FA7F1CF04BF62D2FBA0071178BF0AA75D953_AdjustorThunk','_NativeArray_1_GetHashCode_mE5A1D77C13E970391EDC12DDA1D67ADB2423EEC5_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5C935733377651B184F8EDD744A71BA341592851_AdjustorThunk','_Enumerator_MoveNext_m5E5023FBA26AD5BE482B66445F7A33D4AE8B34BE_AdjustorThunk','_NativeArray_1_GetHashCode_m1A58E3EC7DF72389A8846B623C7ED3F5FD1E83F1_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mFA5A681DB5F3050F3013793B9E862A2A3EF34574_AdjustorThunk','_Enumerator_MoveNext_mDFC9653D896ADE94D9299F39A28A1702E054C5B8_AdjustorThunk','_NativeArray_1_GetHashCode_m0B5D21EA1441CFD6012053112F49AFE5AC43E066_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m72672835C7FB6EFA40689915B1C8CCE0F908B782_AdjustorThunk','_Enumerator_MoveNext_m479D00B49840C2CB34D76D674CAC6DA65362DAED_AdjustorThunk','_NativeArray_1_GetHashCode_m5AFF2FCEDCD57E6C2E5DDE78A96C482768FA8588_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m72AD44EF615C5D7AC43672F683FD88C7FA3FBDE9_AdjustorThunk','_Enumerator_MoveNext_m1B69B4E8587374D22850861E13B691EF88FCEFE5_AdjustorThunk','_Enumerator_MoveNext_m2139443A58F0B4BEFC29B2E2162876B42346C1FC_AdjustorThunk','_NativeArray_1_GetHashCode_m6ACAE362C6CCE9443BA975C764094ACA191FA358_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m59A375BF21931E2B676904E84DEAAA44255DF1A5_AdjustorThunk','_Enumerator_MoveNext_mA20BBA40FC3CB3948248A45FA9F106F02AAF28B7_AdjustorThunk','_NativeArray_1_GetHashCode_m3D32B9948413D241FCB3CBE5D8174F39C0086EB4_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m141C794A4068A58D4D0A66692E8427E400941D47_AdjustorThunk','_Enumerator_MoveNext_mE7D755A9C770999097F11AE543AC1C171AA1068A_AdjustorThunk','_NativeArray_1_GetHashCode_m0D4DE454C46AF6B29D44ECEF9098A2A0CECFA959_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m3997F9657BE5DC63E85823E272F8F4DD81D883C8_AdjustorThunk','_Enumerator_MoveNext_mF76AD13B2F61A40CF9816952DAEDE9D2002C3EA0_AdjustorThunk','_NativeArray_1_GetHashCode_m9C06C67C3050C446C5611FF382A6CA8ABF05C38F_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5448EE1A0EB9F6887F33C456C0FE0CC585DF4B94_AdjustorThunk','_Enumerator_get_Current_m44C3F6AAFEBEAC9CD1F623F49BA27757E568CD25_AdjustorThunk','_Enumerator_MoveNext_m795868D6E72DA5CFBB1ABEDC87F7DD8F3FB8A155_AdjustorThunk','_NativeArray_1_GetHashCode_m0034C504DAE536397CBCB1175086A12E8EB329CD_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m4A9E3F82EF4B528E64F2B7EEBF4B5A4710D92AF0_AdjustorThunk','_Enumerator_MoveNext_m520E08BE088F67C0334D6E091330489C377ECCB0_AdjustorThunk','_NativeArray_1_GetHashCode_m9142745576EFFBDF02436D21101CAD6CC6E40463_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mBE08DCA2B714B887F9F518937DCC14D683C89ACC_AdjustorThunk','_Enumerator_MoveNext_m61D9A389EF8AC75299078DC0B2ED4120ACA8B908_AdjustorThunk','_NativeArray_1_GetHashCode_m6A0C4A60552E87B029CA2C85642AF1BEF5BD5197_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5A4696AD8EAF0DC40AEDC08C7476BA05AB429392_AdjustorThunk','_Enumerator_MoveNext_m6ED50098C9C928510A0B94A509BEFE96F92D2633_AdjustorThunk','_NativeArray_1_GetHashCode_m057D0FF269F2D1B97EF2BDDBCB151CD4D4D5C829_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEAA9B1AEAF50443B646093DC2BC8B2F2AD9DE1AD_AdjustorThunk','_Enumerator_MoveNext_mDB3C65DCA17109605BDAF618BB6602315550D4A9_AdjustorThunk','_NativeArray_1_GetHashCode_mE7997D719B4F20E17117A1C12B95A428F05BA9A8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC66A4EC3719BCA47A06594369F3C151D872B7987_AdjustorThunk','_Enumerator_get_Current_mF8F8D87E1B8FBEF6528E0768CF1B13E024FD69E0_AdjustorThunk','_Enumerator_MoveNext_m88B50F98F0998F40114FBAF1E77F15F14177F88A_AdjustorThunk','_NativeArray_1_GetHashCode_m3ED44B56BE820B99862642E15141A24604120358_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mBFC7E1671A07F017A9C52D1A841B2752C78B1FF7_AdjustorThunk','_Enumerator_get_Current_m6904DA6AEF1244F54C0425F7887FB863BA697BAC_AdjustorThunk','_Enumerator_MoveNext_m831EEB487B20953108235F478969BB1A44B81B5C_AdjustorThunk','_NativeArray_1_GetHashCode_mCD736C3B1CB0E56FFCC130C57DB1FA67AEF0A00E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m087306E4D39963BC9C133BA11A69CC3F1A5297E2_AdjustorThunk','_Enumerator_get_Current_mA96826D3DFBCDD664316B7B6DFCE3D967BE75720_AdjustorThunk','_Enumerator_MoveNext_m83BCC29B5F2D449CB0617662B5EA30C5291AD811_AdjustorThunk','_NativeArray_1_GetHashCode_mBE537F4313627BC175C465A183B16A3E1C2A2952_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m2B083927B132FB6B364316C6976C53C3E1BB6E90_AdjustorThunk','_Enumerator_get_Current_mEE10B0AC8004688B85022EB25DF1314122D68E62_AdjustorThunk','_Enumerator_MoveNext_m827294D73873ABFCD9637AA3880DD56CD22F0E32_AdjustorThunk','_NativeArray_1_GetHashCode_mF8D9CF50F336B4C0013F36D4B29FE16944E1E10A_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m87501BD7021E3233DF9A9DCEC8FD25FDFA17F68A_AdjustorThunk','_Enumerator_MoveNext_mAE23BBEA93A3CFC9B9D159AEB8FD41713DE211FC_AdjustorThunk','_NativeArray_1_GetHashCode_mDDA5D4BC79A8BF91BFA2933A9AB6FA99715C044B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mC05FABDAC652EBDBDA885AAEC4E77F80D27A92AB_AdjustorThunk','_Enumerator_MoveNext_m697C490540EE56340311A3E596D69C72C7B40846_AdjustorThunk','_NativeArray_1_GetHashCode_m0C4339690719DDD6F9F445ADB8B706753499841B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEAB89450B14C31DACEC86119AA1ADA69A3F172E4_AdjustorThunk','_Enumerator_MoveNext_mB21306C2E63F54303FA555C4AFBB378CBB3982B3_AdjustorThunk','_NativeArray_1_GetHashCode_m2D27332537D6C71790B7101F7A579F2738EB5199_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA017B5AC0DE7FB9FCE7C6D850D4FECEBB1C4D04C_AdjustorThunk','_Enumerator_MoveNext_mD2C3DB72BEDE5D5EEE83A8F41C320EB8D14E839C_AdjustorThunk','_NativeArray_1_GetHashCode_mCF629540DEC954537117670E7A2D8530BB5477E6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA7C77B9429A48FC3D83E83F10862965839D193C2_AdjustorThunk','_Enumerator_MoveNext_m9CA6BFA547770E374EDA26B0F6FAC453033E6137_AdjustorThunk','_NativeArray_1_GetHashCode_mB5D9CF4C9C3660357F45CA35AC99A0725B9A085E_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5378D30C8CF3C116F6A8A08357869E895BCAA42E_AdjustorThunk','_Enumerator_MoveNext_mFE3D7D0ED8EEFC917563DE4A381D9E443E45107F_AdjustorThunk','_NativeArray_1_GetHashCode_m5415C7F8A24EF3700A729AC117543724924AADF7_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m3BEED84FF113144DF9AA239454FA3B96E594994A_AdjustorThunk','_Enumerator_MoveNext_mF7977A3DC7E791290E1125BB6552B8097195E53A_AdjustorThunk','_NativeArray_1_GetHashCode_mB030EB8C08E4BE3B5A94C73DBD4548B0E3415F67_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mEFAD68C7FBD3864E7916CE5D898F1965635B4E9A_AdjustorThunk','_Enumerator_MoveNext_m47E28F8562C29FE0044303479332E0C8F2DB4616_AdjustorThunk','_NativeArray_1_GetHashCode_m909C25534AF8E0FB4735057DF513EA17721E3DA3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE9678E812B2F986816E3A56948FFDA617A75EA78_AdjustorThunk','_Enumerator_MoveNext_m068D544063206383C2D32F41E8EEB107FDE4332A_AdjustorThunk','_NativeArray_1_GetHashCode_mBE4E6E4C056B6A63958EA150B12B6866B0E5ED86_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m9AE17DF0AF8A8FF4FBC413435A95BCB6EDB9237B_AdjustorThunk','_Enumerator_MoveNext_mE1F2638FF47B3825ECC00ECE3B4FC8652E10F69E_AdjustorThunk','_NativeArray_1_GetHashCode_m08171CCB397A0E029E7B4F01515786272B38E6AB_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m04675B75AC527E2944AA95B3CCAE44C8C4D930FE_AdjustorThunk','_Enumerator_MoveNext_mA6C10E5DA299835601A98A266EFA7E3EAC1CF4BD_AdjustorThunk','_NativeArray_1_GetHashCode_m1F6800E8F7E2B650805D20B8AC93338E396F10F9_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m6FEAF84D657A1E4529E434FE0D8BE607A260E1FC_AdjustorThunk','_Enumerator_MoveNext_mC5352E1656E9647E5DC75FAC572AABE7DF725A44_AdjustorThunk','_NativeArray_1_GetHashCode_m52513DD9F408CE2CDADED643872F93F56A59A1AC_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m5C4FC75EA51ED7506B2B08284387285E56E02006_AdjustorThunk','_Enumerator_MoveNext_m504D831A190C3FDE4FAA5CE50622F05C5ACAABB5_AdjustorThunk','_NativeArray_1_GetHashCode_m967F032AF87E3DAAE3D31D0C2FB4D5C274A704E2_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA29BF021C41D89BB59C98E0E9ADF99453F763430_AdjustorThunk','_Enumerator_get_Current_m09B5F481B8429B9C2DE6A0648733504046A9F76B_AdjustorThunk','_Enumerator_MoveNext_m62AE692787E8F5A07661A55951ECBEE2F1733764_AdjustorThunk','_NativeArray_1_GetHashCode_mDEA77C70F60F556DFFB0398DE095CA4CCCB8573C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m84D6DAB8A29E484CCCC8AA4398A9A297C32B5F0B_AdjustorThunk','_Enumerator_MoveNext_m731A44C000D1FCA90308DFBAE86A1F81C75B38F8_AdjustorThunk','_NativeArray_1_GetHashCode_m7A80E2BD16B6BBCA9D984A3B134E101DF2A00CE2_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB71CF5F6CDE53C9D8DA0DE7BC3F17D061CDF907C_AdjustorThunk','_Enumerator_get_Current_m78D9ED23905F94707F1B8D633014EEE8E93CBD53_AdjustorThunk','_Enumerator_MoveNext_m331DAD0FAFACCB84108C5C28A933DBBC0ED65667_AdjustorThunk','_NativeArray_1_GetHashCode_m646215019A26FF1CB4263E0F63F9BED206E3AAB9_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mA04DA173121A565403D86386783CB1E5394E595B_AdjustorThunk','_Enumerator_MoveNext_m4DC3D5C87A455B4616C92403A4E0565A096481F8_AdjustorThunk','_NativeArray_1_GetHashCode_mDED3C383D8DD0BD78686FC88CD14C3FDB400A07C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m016B873402B0A3790F32865948B5CC09AB9FE8D5_AdjustorThunk','_Enumerator_MoveNext_m8E9D3D556EDAEB3BCA20934B10B9CBBABED46848_AdjustorThunk','_NativeArray_1_GetHashCode_mCC2061D19D934E096417BB6EFB5DB62755B2802D_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mD620CC2A1E963EC0ED9C0F5889288581C63714D0_AdjustorThunk','_Enumerator_MoveNext_mFDCFC7AB29D691493C863FABDAE71A9EAB0C801B_AdjustorThunk','_NativeArray_1_GetHashCode_m5A8D1E4599E6395293C8C5A703C6CA172B4BC2B1_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m08DF648FCA1E42B152D5F2C94E91CE137B96600F_AdjustorThunk','_Enumerator_MoveNext_mC77CF72C1DB5562E75D022FFB0EC32BAF9A5C9EF_AdjustorThunk','_NativeArray_1_GetHashCode_m1C2AFFBACEBAC187236025930C9071401D71C58A_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB9C793FD0B28D3B17771AFA9B9A0635AA951196B_AdjustorThunk','_Enumerator_MoveNext_mAEE41B121E4499EC5BF38D496532A8A1A6FA4469_AdjustorThunk','_NativeArray_1_GetHashCode_m965C4641D1CB7809B0E78412DEB961B4B110455A_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m91F6C5D974DF1009DF14FCA7F0EE5598DDB55A6C_AdjustorThunk','_Enumerator_MoveNext_m2D125A6979A6F466DB540CF5F8DCF1086B334DD1_AdjustorThunk','_NativeArray_1_GetHashCode_m70EA13C211DDE4030525DD74AC2F586076125C5B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m0C5FBD56A94C606987B599617C8F03085DEC3D86_AdjustorThunk','_Enumerator_MoveNext_m90B65817F19BEC2FA1CEA8C367EEEAC471CCC6BE_AdjustorThunk','_NativeArray_1_GetHashCode_mAE4CBE4FFB8FC7B886587F19424A27E022C5123B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m9CB1F015B89A476B1645F989F610E6A6B89EEBDE_AdjustorThunk','_Enumerator_MoveNext_m25407EC4818BDB26661B89E44EC520BCB92383E5_AdjustorThunk','_NativeArray_1_GetHashCode_m91E3B9A3631C724F119588021114313956FF64D8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mB3A2E6C69D4C27CC25C3BD72CFE6B46C99904891_AdjustorThunk','_Enumerator_MoveNext_mDBFB6094B5FAB259F4A08034823B71B823B98F60_AdjustorThunk','_NativeArray_1_GetHashCode_m1980D96C948D649CF048769BC91078806D7F1952_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m86737BFE31A0DFED2503A73515135247A25FDA41_AdjustorThunk','_Enumerator_MoveNext_mAC0F441A3C56468EEDA2D4FFE61E805F7721BC55_AdjustorThunk','_NativeArray_1_GetHashCode_mF8D5F414E757FA2C2DB50DF91F93FEBA0624251B_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m41AA5E1B638B0A7E4DE6B308741404A89A488C1F_AdjustorThunk','_Enumerator_MoveNext_m2A930399F53D888B078714E1F847A797AECE929F_AdjustorThunk','_NativeArray_1_GetHashCode_m1864F28E54144FBFE208844D3AA37AD72F5D1B7A_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7E51DE8E0203CC08BE100F35A985E83F290DF63A_AdjustorThunk','_Enumerator_MoveNext_mBFC7142744AF5D62505BD2C395AC57495AA7C2EC_AdjustorThunk','_NativeArray_1_GetHashCode_mD6358B9BB31775203640FC2E24DE50DE9BE91444_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m014104A280E939E7852970FCD2D46BBD55AA2C8E_AdjustorThunk','_Enumerator_MoveNext_m6AB4BD52F325959D7E799FB3C0596D6C1FBB610C_AdjustorThunk','_NativeArray_1_GetHashCode_m95FE1AE9C890E875852854A5E5BB643B8B60B4FC_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mD6E93CA73C98AB5F8845131B39D289A822D1CF82_AdjustorThunk','_Enumerator_MoveNext_m4E028544E84BDE88D01F3010D8CA64D7216D5628_AdjustorThunk','_NativeArray_1_GetHashCode_m53AB57C6EDFD1D69493AC0257E005750B7FFDCE5_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m01E42CD80D115FE6E58322E28440E1E08A525472_AdjustorThunk','_Enumerator_MoveNext_m76E380AB6772F25135EE9503D3372BA9E13AA7AA_AdjustorThunk','_NativeArray_1_GetHashCode_mD8C51A15BEE95ACFB7BFDEF52FAC04BB36F0B91F_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m35495F64AD1CFCFBCA14AE8EB08B05EF8AC32520_AdjustorThunk','_Enumerator_MoveNext_m20DB6EB722DF642E2DE5243BD8728ECE54B1C043_AdjustorThunk','_NativeArray_1_GetHashCode_m3582B57101B5BB52D10BF20AA58B40467524E366_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m54D130C9ED14750C5E5CB941AA27D0A07C6EA017_AdjustorThunk','_Enumerator_MoveNext_m0B393B0E1E0F5C1408BAD783B0D05353E0E9AB52_AdjustorThunk','_NativeArray_1_GetHashCode_m967A2BBF96740000DD4CBF08E12A7E826C37C5D5_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m173259EB4CADD42E74444FFE930A6D3A753A3D3F_AdjustorThunk','_Enumerator_MoveNext_m1DCA7A5EC57D1A847891899C5E67645EC1A14BF5_AdjustorThunk','_NativeArray_1_GetHashCode_mAAC3E016D343A908EF5814DAF4BC27F511539783_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m18F9794C04F15962AB0CC9CBDA7D303E1456E87E_AdjustorThunk','_Enumerator_MoveNext_m08EAB788EF9356502BB7DC0B527C28401B796E35_AdjustorThunk','_NativeArray_1_GetHashCode_m75EE3771F9EB84A6B37970DE204D5516AEC33C46_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8E51BC6EA38F4EA64EF4E2D75221ED74E57A8047_AdjustorThunk','_Enumerator_MoveNext_mBA68DD436543E0602F8A879BCFB8574E00442459_AdjustorThunk','_NativeArray_1_GetHashCode_mE0FCE180A751227805C844C352B7850B2700C609_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m8640718F81708C61D5CE44B3268A40135CFDFC8E_AdjustorThunk','_Enumerator_MoveNext_m3820998DE6E4C2FC9C2F13823D3AB349A7001926_AdjustorThunk','_NativeArray_1_GetHashCode_m99F2776A02AFF04B5E561AD5A4E83A074017506C_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m77F21B38A99EA2E05C98BF5DC1095889E61B5C8C_AdjustorThunk','_Enumerator_MoveNext_m27AAB86651AC466F4770FD7402A3F2383D7D5CD1_AdjustorThunk','_NativeArray_1_GetHashCode_mA68BAF11E658B9BD088EE7E9249A11FBCF6A0104_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mBA72C10271CEC7D95634E180CDABBFB9C0495522_AdjustorThunk','_Enumerator_MoveNext_mD716D24CA4C0AEA7731D0009FBCBDD3480E98DC1_AdjustorThunk','_NativeArray_1_GetHashCode_mECAD8FC63FD2153E6F5514C6DC965DB2FD2C07F6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m72BCDC67D9FD47F1CD4110B9F59D6A37556FF851_AdjustorThunk','_Enumerator_MoveNext_mF6850FF6793A654346743B6F8DEBACDC428F8817_AdjustorThunk','_NativeArray_1_GetHashCode_mF2133A8BF0C0F3DDAA816AAF25E105529107D6F3_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m417DB5CFE4D99231624966D91E73DD19D09EA430_AdjustorThunk','_Enumerator_MoveNext_m79A62FCF8983C66AD702851CA3C7ED4A41B26C80_AdjustorThunk','_NativeArray_1_GetHashCode_mD6278FDBDBA6EECB0109F94A0EF7B126A2B6F5C5_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m1E165EAEF745C13A81BDAC160E54A8E323391EFD_AdjustorThunk','_Enumerator_MoveNext_m696FC72BCD74D6764807F409C49AE24264646E37_AdjustorThunk','_NativeArray_1_GetHashCode_mDAA72F0E5D4B0917DCEDF2234A67BF065CBF5EAD_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m6133C3D39E0FADC7E3EA3A845A40382E33A7DD58_AdjustorThunk','_Enumerator_MoveNext_mBAE60FE5064DB103F75993BEC7AED9484E35E9B3_AdjustorThunk','_NativeArray_1_GetHashCode_mDD91EDED67A5949B4D788FCA68E099788722A5B6_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE720EE39568473458459C18192956838327987C1_AdjustorThunk','_Enumerator_MoveNext_mB060B4B05DB23C11885B6AA5AE98FF33C4FFB418_AdjustorThunk','_NativeArray_1_GetHashCode_m24E2443C6EFC50EE8B50584105054A0FCF02F716_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_mE7A2DA8995990F75341C3FB3057D4E725892DE0B_AdjustorThunk','_Enumerator_MoveNext_m844C6ABC8F1C0EE62E0382EEF4C22BDE95998176_AdjustorThunk','_NativeArray_1_GetHashCode_m3BAFC3EAABE3CF4517BF606C652705B720ED01E8_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m1B20B86E8D32D75BC23890639C5B761E875FD6E0_AdjustorThunk','_Enumerator_MoveNext_m74D6DEC95648C8659C98CB5C28CAA5489190F236_AdjustorThunk','_NativeArray_1_GetHashCode_m6183D33A22EC9E1B181D3946D4942CD6958D54FE_AdjustorThunk','_NativeArray_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m7E3DE24BA4781C7BC214953951326E757E31F51E_AdjustorThunk','_Enumerator_MoveNext_mA714BE83ABF1ACF9968E68ED752A72EF6807272E_AdjustorThunk','_NativeSlice_1_GetHashCode_mBA5641011EEB465ABBD2F3E1A75038C12F930C10_AdjustorThunk','_NativeSlice_1_System_Collections_Generic_IEnumerableU3CTU3E_GetEnumerator_m88B80649CEEAE9DED1C44F218CBE504BF2020426_AdjustorThunk','_BlobAssetReference_1_GetHashCode_mD08A441715EB8CD3BEB4349B409231892AD3E278_AdjustorThunk','_BlobAssetReference_1_GetHashCode_mD006A90F6FEE14ACE07420BD056D267D0585FD2D_AdjustorThunk','_BlobAssetReference_1_GetHashCode_mD8D0F4377556E8D5277AE915687ADD7CA2056AF9_AdjustorThunk','_BlobAssetReference_1_GetHashCode_m5A7F89434EEA30CDF3ED60079827BB6CD549A86F_AdjustorThunk','_GatherComponentDataJob_1_PrepareJobAtScheduleTimeFn_Gen_m86C82632A458B0825667A4F960E67CF659501441_AdjustorThunk','_GatherComponentDataJob_1_GetExecuteMethod_Gen_mFB87FBF0B4533607B1532110C845202538A8BEF3_AdjustorThunk','_GatherComponentDataJob_1_GetUnmanagedJobSize_Gen_m997AA20B9B32542126D1D5D4DFF3E83813557032_AdjustorThunk','_GatherComponentDataJob_1_GetMarshalMethod_Gen_mAB02E119854475B484EA2EA75F0313B881C1D870_AdjustorThunk','_GatherEntitiesJob_PrepareJobAtScheduleTimeFn_Gen_mC9EA8FF8355507D44577B21FE4310DF50D467A22_AdjustorThunk','_GatherEntitiesJob_GetExecuteMethod_Gen_mDBE189BB32DA6B90B212F0AB1DEA51767572B116_AdjustorThunk','_GatherEntitiesJob_GetUnmanagedJobSize_Gen_m01F08F368DF6B3378709C526EDDCA4C7DDC73C75_AdjustorThunk','_GatherEntitiesJob_GetMarshalMethod_Gen_m3962663DBF664D37A916D68CE190331EE7173833_AdjustorThunk','_SubmitSimpleLitMeshJob_PrepareJobAtScheduleTimeFn_Gen_m38AC4AAC131BB9998B56B9D2FB45C5AB00CC1537_AdjustorThunk','_SubmitSimpleLitMeshJob_GetExecuteMethod_Gen_m09A1362E948CB332B6249BD1D642BC3F2D7ADF3A_AdjustorThunk','_SubmitSimpleLitMeshJob_GetUnmanagedJobSize_Gen_m67E0110D035BF2AFF5377DCF50EC52582E4C2355_AdjustorThunk','_SubmitSimpleLitMeshJob_GetMarshalMethod_Gen_m58C2524853A266431018DCDB293452B3DFE4E0AA_AdjustorThunk','_BuildEntityGuidHashMapJob_PrepareJobAtScheduleTimeFn_Gen_m20790F910CEB8EA54229CA7D14B6C6DEB46A8D74_AdjustorThunk','_BuildEntityGuidHashMapJob_GetExecuteMethod_Gen_m9EDCC5EA59F11156D6493765124A1AF5F10C0B4C_AdjustorThunk','_BuildEntityGuidHashMapJob_GetUnmanagedJobSize_Gen_mE9494650B1214D3108948AA9148BEE43BA1EDE22_AdjustorThunk','_BuildEntityGuidHashMapJob_GetMarshalMethod_Gen_m0C39865D8FACD1C42CDB78CE0C70338C3BC18742_AdjustorThunk','_ToCompositeRotation_PrepareJobAtScheduleTimeFn_Gen_m1BD14524FA4DEB8F28DA1163F6CD79BB125B3C2D_AdjustorThunk','_ToCompositeRotation_GetExecuteMethod_Gen_mB366744FCF79553C571E4454E29DFACD7ACDF604_AdjustorThunk','_ToCompositeRotation_GetUnmanagedJobSize_Gen_m56DF8880EA7AAE231FC0D9C51F232A4F7C306B62_AdjustorThunk','_ToCompositeRotation_GetMarshalMethod_Gen_m5F5DED9E4CA54DCC64F00C44EC60DBB3C84B2D16_AdjustorThunk','_ToCompositeScale_PrepareJobAtScheduleTimeFn_Gen_m2C720D5633917E9B204EA524348C9569B301D5C1_AdjustorThunk','_ToCompositeScale_GetExecuteMethod_Gen_mC0AFB129E75E2C4A0A3C177B79BB4CA34CDB8125_AdjustorThunk','_ToCompositeScale_GetUnmanagedJobSize_Gen_mD19C63A2E1A54BBD499CD3BA95472FFF69973971_AdjustorThunk','_ToCompositeScale_GetMarshalMethod_Gen_m62DB54F673F51B2DE0B0EBD4AAAC0EDBA2A2DD9C_AdjustorThunk','_UpdateHierarchy_PrepareJobAtScheduleTimeFn_Gen_mB87D837465FAE9EC13627DBB79E75B747A4D4DFC_AdjustorThunk','_UpdateHierarchy_GetExecuteMethod_Gen_m9D18B122D4DB4ED1A141ADBE6FABBCE1DB110D20_AdjustorThunk','_UpdateHierarchy_GetUnmanagedJobSize_Gen_m266CB6EB99B53D4E2673D6F7F0352F5154C25190_AdjustorThunk','_UpdateHierarchy_GetMarshalMethod_Gen_m47B23F93E43FDB2777FED9309649A39E6C26331F_AdjustorThunk','_ToChildParentScaleInverse_PrepareJobAtScheduleTimeFn_Gen_m051FCF8EF5EF47B25CEA9E169AD2716C451E6918_AdjustorThunk','_ToChildParentScaleInverse_GetExecuteMethod_Gen_mDAABB8E7FC354B3558D9B3684E58802535DD2AD6_AdjustorThunk','_ToChildParentScaleInverse_GetUnmanagedJobSize_Gen_m1697266B67D6205073BB8817AF525505F76560BD_AdjustorThunk','_ToChildParentScaleInverse_GetMarshalMethod_Gen_mF9CC1ED4E7C9FB5E54CF85334AE337CB495D0B09_AdjustorThunk','_GatherChangedParents_PrepareJobAtScheduleTimeFn_Gen_mAAEA0FD0B7A5CDD1A6FE295465B005746EEE4F9E_AdjustorThunk','_GatherChangedParents_GetExecuteMethod_Gen_mFF235231C878260D10BD22E4D4FA94EB86624972_AdjustorThunk','_GatherChangedParents_GetUnmanagedJobSize_Gen_m46B828B72A98CA47CE86DEE6A3670FC8FFE20720_AdjustorThunk','_GatherChangedParents_GetMarshalMethod_Gen_mEE7C48B6089F0D4E54DF3AE8DEE9AC7D5AE9FF6F_AdjustorThunk','_PostRotationEulerToPostRotation_PrepareJobAtScheduleTimeFn_Gen_m195B093FBDC87DAEC5C6C49C449DFF0E5BE27305_AdjustorThunk','_PostRotationEulerToPostRotation_GetExecuteMethod_Gen_m175878B312E13FD0087D32F65E50B33CBE063266_AdjustorThunk','_PostRotationEulerToPostRotation_GetUnmanagedJobSize_Gen_m678A49409074B1E20125FE0FAE372346D2E9BF32_AdjustorThunk','_PostRotationEulerToPostRotation_GetMarshalMethod_Gen_m646B2DA0DDAD6077367FFBA191B8BA640A9013FD_AdjustorThunk','_RotationEulerToRotation_PrepareJobAtScheduleTimeFn_Gen_mC5DBB7F4FB7F6DB81E564233D306B23ED7A65739_AdjustorThunk','_RotationEulerToRotation_GetExecuteMethod_Gen_m3F919B728959CD6F973588FC78EEE34122945066_AdjustorThunk','_RotationEulerToRotation_GetUnmanagedJobSize_Gen_mAA1A1283253C23EAC14B71714CFAA3BE84790E51_AdjustorThunk','_RotationEulerToRotation_GetMarshalMethod_Gen_m73E439744C3BCAE889544637B26B09610C164260_AdjustorThunk','_TRSToLocalToParent_PrepareJobAtScheduleTimeFn_Gen_m80CD1C7BF8682A145FE6DFA32BECEF3AC6AD4C7E_AdjustorThunk','_TRSToLocalToParent_GetExecuteMethod_Gen_m1F0849B962E0417F604D88CDB7EC63774EFDD898_AdjustorThunk','_TRSToLocalToParent_GetUnmanagedJobSize_Gen_m54C10A8730CBBB8096C3E249DE5BAD385CE1F9BF_AdjustorThunk','_TRSToLocalToParent_GetMarshalMethod_Gen_m7A7BBB2215C5AFBDFC942198D4E9B4B943BF875B_AdjustorThunk','_TRSToLocalToWorld_PrepareJobAtScheduleTimeFn_Gen_m3415BA474538216A581A1E270D95CF75AFDCD9B6_AdjustorThunk','_TRSToLocalToWorld_GetExecuteMethod_Gen_m3CDA4B3428F4779886F83D4F5E5226D3B7C62800_AdjustorThunk','_TRSToLocalToWorld_GetUnmanagedJobSize_Gen_m66819AD5354D28FD994C20E422AF65CFAAF16862_AdjustorThunk','_TRSToLocalToWorld_GetMarshalMethod_Gen_mF9B1A07D09C6636EEE089CA932592E8EF8F4F325_AdjustorThunk','_ToWorldToLocal_PrepareJobAtScheduleTimeFn_Gen_m21C8981E86F60D1BD57E349CD30DA8D26AA220D9_AdjustorThunk','_ToWorldToLocal_GetExecuteMethod_Gen_mAAE3BC1CFC22889406055A387523D296EC7F985E_AdjustorThunk','_ToWorldToLocal_GetUnmanagedJobSize_Gen_m50DE52172BA4768E4AEAE81D36A5B0FFC6C33E40_AdjustorThunk','_ToWorldToLocal_GetMarshalMethod_Gen_mED83CC2625CC1EE2A6B2EC0C4F2413A19865EE60_AdjustorThunk','_DestroyChunks_PrepareJobAtScheduleTimeFn_Gen_m54C66E741847B0F8E2399F257431C32559B83D52_AdjustorThunk','_DestroyChunks_GetExecuteMethod_Gen_m16E91E244726B2DE6A2511BDD0C7D1B7B97C19B9_AdjustorThunk','_DestroyChunks_GetUnmanagedJobSize_Gen_m25B0D42C76FD88CE64C19FD30FB8E7809ACBB4A3_AdjustorThunk','_DestroyChunks_GetMarshalMethod_Gen_m1E32B9BD104585952949EB39DB483DC63A5EAA40_AdjustorThunk','_SegmentSortMerge_1_PrepareJobAtScheduleTimeFn_Gen_m95761CEE2346D82E0E517713D9EB1962AC314372_AdjustorThunk','_SegmentSortMerge_1_GetExecuteMethod_Gen_m8600198BAD54095ABB572DA918C7DBDA48CF95FA_AdjustorThunk','_SegmentSortMerge_1_GetUnmanagedJobSize_Gen_m9CF55ABD086775CD830D37B587AD788E765CE8B8_AdjustorThunk','_SegmentSortMerge_1_GetMarshalMethod_Gen_mEBA11499319099B692D49F05BD1C90805C3B6795_AdjustorThunk','_CalculateEntityCountJob_PrepareJobAtScheduleTimeFn_Gen_mEBC74570D54BC5CA0C72C0C10729C86736EE2B23_AdjustorThunk','_CalculateEntityCountJob_GetExecuteMethod_Gen_mE61547384E6777162C498DEF088DCCF74BFE889F_AdjustorThunk','_CalculateEntityCountJob_GetUnmanagedJobSize_Gen_mDB26929D2BDB6407632F304D38720E9388D09203_AdjustorThunk','_CalculateEntityCountJob_GetMarshalMethod_Gen_m5BD73BEC53287EACAEB0350C2BB69F5AC4CC7A05_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_PrepareJobAtScheduleTimeFn_Gen_m5359E3E47EBB49B1C6723F407C6DD3DD46B42DA9_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_GetExecuteMethod_Gen_mADBC1323F50D918308784DA5D4A853A32EF2170C_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_GetUnmanagedJobSize_Gen_mC1E6DEBBBA82FEFB3F7BDE04DDC8B207B75E5E76_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_GetMarshalMethod_Gen_mABBDE9ABAC908EF4774C77F5066F443623B84B85_AdjustorThunk','_ChunkPatchEntities_PrepareJobAtScheduleTimeFn_Gen_m82BF15AC2A1638552EE0FD1465322E21CC8BF177_AdjustorThunk','_ChunkPatchEntities_GetExecuteMethod_Gen_m916C321D0C07BAE6AD6A4E46E25F54837DD95D21_AdjustorThunk','_ChunkPatchEntities_GetUnmanagedJobSize_Gen_m777B0536A6467134388E83107D88F2A4298E19CF_AdjustorThunk','_ChunkPatchEntities_GetMarshalMethod_Gen_m31E71269DE948E0D4244AD642366A1793F54EB31_AdjustorThunk','_MoveAllChunksJob_PrepareJobAtScheduleTimeFn_Gen_m395357651D0B27F39D43669A67EB98D31AFBE62A_AdjustorThunk','_MoveAllChunksJob_GetExecuteMethod_Gen_m35F87D05664A4F006F6668F3D7FEEAF6768F7ECD_AdjustorThunk','_MoveAllChunksJob_GetUnmanagedJobSize_Gen_m6E207DD7AFA2B153D17D770446CAA5ADB24A6666_AdjustorThunk','_MoveAllChunksJob_GetMarshalMethod_Gen_m86819023B121098DB30444803ABC3C4BB1D36687_AdjustorThunk','_MoveChunksJob_PrepareJobAtScheduleTimeFn_Gen_mC443FFAD4237BF70FE3070FF2E6D0C7783A445E8_AdjustorThunk','_MoveChunksJob_GetExecuteMethod_Gen_mD177DF2E67BE7D26B7DC023EA3FD9D7D4D5D354D_AdjustorThunk','_MoveChunksJob_GetUnmanagedJobSize_Gen_m979A783BA1CEEF1C80D77B374A1AC653D73940A2_AdjustorThunk','_MoveChunksJob_GetMarshalMethod_Gen_m099DE06820AEF2416D20E5652ED316FA36D69FD3_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_PrepareJobAtScheduleTimeFn_Gen_m7D9BCADF50E0A8DE403E57DC612E5074EC72FF48_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_GetExecuteMethod_Gen_mDE9C33F01C8103206FB695506B99ED3A6D80834C_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_GetUnmanagedJobSize_Gen_m7339C377F7C68CFE31E598324B5A6FEAC4F3E342_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_GetMarshalMethod_Gen_mF5D86DC8322ADC78913D5B59B0EA585DD0CAACB9_AdjustorThunk','_GatherChunksAndOffsetsJob_PrepareJobAtScheduleTimeFn_Gen_m02EED845D0A650A87FE89641BA29903D0A6D5131_AdjustorThunk','_GatherChunksAndOffsetsJob_GetExecuteMethod_Gen_m67943DDCD581BEB2480AFEDAF69C290A97D81466_AdjustorThunk','_GatherChunksAndOffsetsJob_GetUnmanagedJobSize_Gen_m73CCA84375C7E9DBE74330D42E5967A05B443D5F_AdjustorThunk','_GatherChunksAndOffsetsJob_GetMarshalMethod_Gen_m5A1EBD5BAD0911B25CD4AFFDB373C69943B137BA_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_PrepareJobAtScheduleTimeFn_Gen_m35DF6E7EA0D9B95BD82EC56E397251A07B85D218_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_GetExecuteMethod_Gen_m55E40FE8F8B9BECFFDC270D1DB42038425AB05D0_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_GetUnmanagedJobSize_Gen_mE108B40D181B690BDAE90607D61E520FD3658BAD_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_GetMarshalMethod_Gen_m7A692473D1BB454A6EEE3E0E53537687EDC6B7E5_AdjustorThunk','_FindMissingChild_PrepareJobAtScheduleTimeFn_Gen_m105722506954B808FAC0FE34C1CBD18505E26AA9_AdjustorThunk','_FindMissingChild_GetExecuteMethod_Gen_mF46DCD52EF6642CC4FAA54D8158A9EC935F42063_AdjustorThunk','_FindMissingChild_GetUnmanagedJobSize_Gen_m6D924104398D9C0F8A57C61EE28351E898FC8089_AdjustorThunk','_FindMissingChild_GetMarshalMethod_Gen_mF65075752E5C8A97B17164DF62F4431271E399A6_AdjustorThunk','_FixupChangedChildren_PrepareJobAtScheduleTimeFn_Gen_m5F2F88DF627703368DF77FCF519EC277D4024A26_AdjustorThunk','_FixupChangedChildren_GetExecuteMethod_Gen_mD1BB573ACE350E1D17F65F31E4444E1A4DE099CB_AdjustorThunk','_FixupChangedChildren_GetUnmanagedJobSize_Gen_mB19FD3594618BCBBED699995CDDA7A9BE528C256_AdjustorThunk','_FixupChangedChildren_GetMarshalMethod_Gen_m5A5928C580323EA3D02D241CD71676397FF2036F_AdjustorThunk','_GatherChildEntities_PrepareJobAtScheduleTimeFn_Gen_m75E4EF5AFEA08A6C103D0187ADA7687D17F3272D_AdjustorThunk','_GatherChildEntities_GetExecuteMethod_Gen_m4E82C7D9736017F1CB0CF92CC56D1D80F59C0465_AdjustorThunk','_GatherChildEntities_GetUnmanagedJobSize_Gen_m028283474D9981A0C0A2010D41A1024AF571EC87_AdjustorThunk','_GatherChildEntities_GetMarshalMethod_Gen_m5A28B66029A9A615F5FD433D442F70D199C6F512_AdjustorThunk','_SegmentSort_1_PrepareJobAtScheduleTimeFn_Gen_mA00EFF17DA1AED5C3CCF7E4E5AFD9EFFF9B367C4_AdjustorThunk','_SegmentSort_1_GetExecuteMethod_Gen_m51E07745331F934F53266A7D86C3983ECBC27FD2_AdjustorThunk','_SegmentSort_1_GetUnmanagedJobSize_Gen_m0EC645E7D1BBA4A6D4F6B081800EC2FF0F69B0D7_AdjustorThunk','_SegmentSort_1_GetMarshalMethod_Gen_m4FF0354861C309C0795EA2061F8FE5E18ACF53F2_AdjustorThunk','_GatherEntityInChunkForEntities_PrepareJobAtScheduleTimeFn_Gen_m8753653DFF57A103D0703E55000FD5718349130C_AdjustorThunk','_GatherEntityInChunkForEntities_GetExecuteMethod_Gen_mC786F10E65430307BB03B12FEFB44EE587A4A1DD_AdjustorThunk','_GatherEntityInChunkForEntities_GetUnmanagedJobSize_Gen_m0A0FBA476F0AF4D04DDAFD8D4B195EC6CDC9662F_AdjustorThunk','_GatherEntityInChunkForEntities_GetMarshalMethod_Gen_m0208044662320C84DF176DABF8A5714A59B0D2AA_AdjustorThunk','_RemapAllArchetypesJob_PrepareJobAtScheduleTimeFn_Gen_m7CA424A4490B13D070B506CF2062AA14F1A01015_AdjustorThunk','_RemapAllArchetypesJob_GetExecuteMethod_Gen_m8F288D3C9F6AB5B2C83E9EF25E1970D64F37153F_AdjustorThunk','_RemapAllArchetypesJob_GetUnmanagedJobSize_Gen_mC91D58BC3745304B44506D9ECDA5435951506BFF_AdjustorThunk','_RemapAllArchetypesJob_GetMarshalMethod_Gen_mBF58510FA88A1CFCC83FFE4D4D1B0D3EC7701F27_AdjustorThunk','_RemapAllChunksJob_PrepareJobAtScheduleTimeFn_Gen_m8BECB15B4EA058B6347980F80DE00C78B6E40626_AdjustorThunk','_RemapAllChunksJob_GetExecuteMethod_Gen_m1881CA08D884F88FA9A63A9C6E842D0844F3CDB6_AdjustorThunk','_RemapAllChunksJob_GetUnmanagedJobSize_Gen_m5DA8B3B8D0DC172F80B101880D0704813EE57A48_AdjustorThunk','_RemapAllChunksJob_GetMarshalMethod_Gen_mAF33BAF625E72AF07C9EDF9E8353AB3420BBB0CF_AdjustorThunk','_RemapChunksFilteredJob_PrepareJobAtScheduleTimeFn_Gen_m4A71CC73FA43AF1483105782B811788D8BBB9EF0_AdjustorThunk','_RemapChunksFilteredJob_GetExecuteMethod_Gen_m88E755FE0014FD72EC3539758A219CC76AD111B5_AdjustorThunk','_RemapChunksFilteredJob_GetUnmanagedJobSize_Gen_mCA45B0005D4BA367A1E7082F05E845B148E25FB1_AdjustorThunk','_RemapChunksFilteredJob_GetMarshalMethod_Gen_m9105EED4CEDDBCF5E7E1149360544AD9F9C0C8CE_AdjustorThunk','_RemapManagedArraysJob_PrepareJobAtScheduleTimeFn_Gen_m0B5C2144B9692C9FF5E4B5D3B04D863D78554562_AdjustorThunk','_RemapManagedArraysJob_GetExecuteMethod_Gen_m73FB822A7595278347E17FB3E9FA852152DBD50A_AdjustorThunk','_RemapManagedArraysJob_GetUnmanagedJobSize_Gen_mD684FB3B5B40265A4E38A616F22207F321BE0484_AdjustorThunk','_RemapManagedArraysJob_GetMarshalMethod_Gen_m2B3F4D7C6DEBFF3D46ECFC7F7C33D6A2103D40BD_AdjustorThunk','_GatherChunks_PrepareJobAtScheduleTimeFn_Gen_m17E2A5CD847201794983710C48151D1674425951_AdjustorThunk','_GatherChunks_GetExecuteMethod_Gen_mCF09FAF4A2EBF6C1ABDFA83CAC17A46C907864D6_AdjustorThunk','_GatherChunks_GetUnmanagedJobSize_Gen_mCAD7501012ECAABAA3F5CF8AD50ABC3FFA9F70B1_AdjustorThunk','_GatherChunks_GetMarshalMethod_Gen_m227DF9313ADF547267B2069E21C2EDBB99DCD8B7_AdjustorThunk','_GatherChunksWithFiltering_PrepareJobAtScheduleTimeFn_Gen_mBC7477B0B6864139B2594B2B86F1CA218D6F6856_AdjustorThunk','_GatherChunksWithFiltering_GetExecuteMethod_Gen_m055D975760379D0563862F1F35246848534F3509_AdjustorThunk','_GatherChunksWithFiltering_GetUnmanagedJobSize_Gen_mCC3A2AB96148B8FFE08AE1EBEA31C3082B7FC0FF_AdjustorThunk','_GatherChunksWithFiltering_GetMarshalMethod_Gen_m5801234B3929401A4826F05A328EAFA929B6EA9F_AdjustorThunk','_JoinChunksJob_PrepareJobAtScheduleTimeFn_Gen_mA890678AA535B005A0AEFE5DCAE3C8CAA58A3C7D_AdjustorThunk','_JoinChunksJob_GetExecuteMethod_Gen_m35269015F2DF91F3C693C26086C001FD6F7038B1_AdjustorThunk','_JoinChunksJob_GetUnmanagedJobSize_Gen_m705675A692B3666C3E0E067EE008A3B30BA04F38_AdjustorThunk','_JoinChunksJob_GetMarshalMethod_Gen_m599732488EF768D9D19EC15B42762F1E1E5C28D4_AdjustorThunk','__ZNK4bgfx2gl17RendererContextGL15getRendererTypeEv','__ZNK4bgfx2gl17RendererContextGL15getRendererNameEv','__ZN4bgfx2gl17RendererContextGL15isDeviceRemovedEv','__ZN2bx17StaticMemoryBlock7getSizeEv','__ZN4bgfx4noop14rendererCreateERKNS_4InitE','__ZN4bgfx4d3d914rendererCreateERKNS_4InitE','__ZN4bgfx5d3d1114rendererCreateERKNS_4InitE','__ZN4bgfx5d3d1214rendererCreateERKNS_4InitE','__ZN4bgfx3gnm14rendererCreateERKNS_4InitE','__ZN4bgfx3nvn14rendererCreateERKNS_4InitE','__ZN4bgfx2gl14rendererCreateERKNS_4InitE','__ZN4bgfx2vk14rendererCreateERKNS_4InitE','__ZNK4bgfx4noop19RendererContextNOOP15getRendererTypeEv','__ZNK4bgfx4noop19RendererContextNOOP15getRendererNameEv','__ZN4bgfx4noop19RendererContextNOOP15isDeviceRemovedEv','___stdio_close','_U3CU3Ec__DisplayClass0_0_U3CMainU3Eb__0_m38308E5629152C6F37DDB1F8B7C2F30141860823','__ZL10RevealLinkPv','__ZN6il2cpp2gc19AppendOnlyGCHashMapIKlP20Il2CppReflectionTypeNS_5utils15PassThroughHashIlEENSt3__28equal_toIS2_EEE10CopyValuesEPv','_emscripten_glCheckFramebufferStatus','_emscripten_glCreateShader','_emscripten_glGetString','_emscripten_glIsBuffer','_emscripten_glIsEnabled','_emscripten_glIsFramebuffer','_emscripten_glIsProgram','_emscripten_glIsRenderbuffer','_emscripten_glIsShader','_emscripten_glIsTexture','_emscripten_glIsQueryEXT','_emscripten_glIsVertexArrayOES','_emscripten_glIsQuery','_emscripten_glUnmapBuffer','_emscripten_glIsVertexArray','_emscripten_glIsSync','_emscripten_glIsSampler','_emscripten_glIsTransformFeedback',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iid = [0,'_Double_CompareTo_m2204D1B6D890E9FE7299201A9B40BA3A59B80B75_AdjustorThunk','_Double_Equals_mA93F2BE22704B8C9EB96046B086ECA4435D642CA_AdjustorThunk',0];
var debug_table_iif = [0,'_Single_CompareTo_mD69065F0577564B853D364799E1CB0BA89D1B3A2_AdjustorThunk','_Single_Equals_m695797809B227FBC67516D4E43F661CE26325A86_AdjustorThunk',0];
var debug_table_iii = [0,'_ValueType_Equals_mEE494DD557D8885FC184A9ACB7948009A2B8A2FF','_Object_Equals_mA588431DA6FD1C02DAAC5E5623EF25E54D6AC2CF','_String_Equals_m8EF21AF1F665E278F58B8EE2E636501509E37420','_Int32_Equals_mF0C734DA2537887C0FB8481E97B441C6EFF94535_AdjustorThunk','_Int32_CompareTo_mCC31C7385E40B142951B542A7D002792A32E8656_AdjustorThunk','_NumberFormatInfo_GetFormat_mD0EB9E76621B46DE10D547A3CE10B64DE2D57A7F','_UInt32_Equals_m9FC90177169F42A34EFDDC393609A504CE67538A_AdjustorThunk','_UInt32_CompareTo_m2F3E12AD416BA8DCE08F5C54E9CABAFB94A18170_AdjustorThunk','_Guid_Equals_m5CFDE98D8F0D0666F0D63DEBB51CDF24AD891F40_AdjustorThunk','_Guid_CompareTo_m635746EA8CED3D4476CE74F8787310AFC57AEFC0_AdjustorThunk','_Guid_Equals_m4E37FD75580BEC68125508336F314F7D42997E1D_AdjustorThunk','_IntPtr_Equals_m4F97A76533CACEECD082EF639B3CE587CF9146B0_AdjustorThunk','_Enum_Equals_m18E82B9196EBA27815FA4BBE1A2A31E0AFCB8B54','_SByte_Equals_m5C1251272315CA14404DB1417B351B8489B89B96_AdjustorThunk','_SByte_CompareTo_mA406A19828A323C071A676F8ABDF1522982A71F8_AdjustorThunk','_Byte_Equals_m9149D4BDB8834AD79F18A3B973DEF5C050B855D2_AdjustorThunk','_Byte_CompareTo_m901D408ED147198D917F7AB0A0C4FA04B1A8AA32_AdjustorThunk','_Int16_Equals_mD04B4E653666D8266CFD21E1ADD9D466639BA890_AdjustorThunk','_Int16_CompareTo_m664B140D73E6B09CE806A689AA940D14C150B35F_AdjustorThunk','_UInt16_Equals_m73308B26E6618109710F039C7BB8E22CE5670529_AdjustorThunk','_UInt16_CompareTo_mC7B898354424F5CA6066F3AF0A3276D1A71C27F5_AdjustorThunk','_UIntPtr_Equals_m28C138F952F22CFBC3737208ADA93F05B8804802_AdjustorThunk','_bool4_Equals_m16C6A83ED61ACF4A3B18296B5CD8AC87354B2185_AdjustorThunk','_bool4_Equals_m8CA8401F2096436C18CDD4DC003BED60265AFC5E_AdjustorThunk','_float2_Equals_mB9C9DA2AF09FF68054FE96FC54BF5256D8812FD9_AdjustorThunk','_float2_Equals_m7B70628801F4833DAB85E08DE01B853E1BAB3B01_AdjustorThunk','_float4_Equals_m9D39B0C2F3B258DFE32BC4DF9C336CA53FB01C8C_AdjustorThunk','_float4_Equals_m304B8FCAD7E6F0A7F0B5627F264F4A85E824FA21_AdjustorThunk','_float3_Equals_mE47DABC0C9A780512ED16E16AEF8BC281DD4830C_AdjustorThunk','_float3_Equals_mD907D4D448B5C8F48E8A80990F482F77A57DF520_AdjustorThunk','_float3x3_Equals_mFE36EBED6FDB5DA7AE80F8508EB51DF5F48C86CE_AdjustorThunk','_float3x3_Equals_m7F751F6F5B0009FB462E989800A234ECBC9D8DF3_AdjustorThunk','_uint3_Equals_m42E00C7EAD53725C48642FA60CEBAC62C33C24E9_AdjustorThunk','_uint3_Equals_mA68ACCC408ACA27FBF6A04D330906B2D6611D919_AdjustorThunk','_float4x4_Equals_mEC3A38C4484251F997A1AE94FCBB12626077D3E6_AdjustorThunk','_float4x4_Equals_mBAF370F397DEC9CEA58FF78FBF68E3813FD3A88E_AdjustorThunk','_uint4_Equals_m0A07A846236F3F0D5C37D221617D693CAD333AEF_AdjustorThunk','_uint4_Equals_m0A69791A8BCBEE1532F40BC5C28C48A1496A2588_AdjustorThunk','_uint2_Equals_m486320DA825FC95194D5831B96E52DB113CC023F_AdjustorThunk','_uint2_Equals_m92043463D1AF6F25D28BD6C1FBD20686899886FD_AdjustorThunk','_il2cpp_virtual_remap_enum1_equals','_quaternion_Equals_mB9B9BF3C94A7D7D555825FB54B64B02DCB89A151_AdjustorThunk','_quaternion_Equals_mC9DC919B846AEE486EE21CB92E451F45841A3447_AdjustorThunk','_FixedListByte32_Equals_m2A83370B9A0EFE6D4F548025203A72479434EE1A_AdjustorThunk','_FixedListByte32_Equals_m5E5E677C5B3CA249FBE7A54F96A750A4BDD49ADD_AdjustorThunk','_FixedListByte32_CompareTo_mEEF1CFAD2DFCEE4B033CA53957FBC9D92660C8AA_AdjustorThunk','_FixedListByte32_Equals_mA7856B11C2406A7F85E8A77869B606AFF159EC88_AdjustorThunk','_FixedListByte32_CompareTo_m0421DB9EB4E45582B0B8656949505AE83E37A35B_AdjustorThunk','_FixedListByte32_Equals_mAA941825962EA0E1B51F3D7AF72E30B8ECD61C02_AdjustorThunk','_FixedListByte32_CompareTo_m318FFBFDBD2A810E9287CD73D5FF23D57FC8B9B3_AdjustorThunk','_FixedListByte32_Equals_mB267903AAFF06DAACECD9E9195D53D6FA2D7E41D_AdjustorThunk','_FixedListByte32_CompareTo_mF5F8CA0974FDDE1E900702B32DF8E51A186B9FA8_AdjustorThunk','_FixedListByte32_Equals_m63EDE5A53EBB4B00864D694817DBAFC4F41B09F7_AdjustorThunk','_FixedListByte32_CompareTo_m1A4B3199DB75E6BBB5A684B4080B2B85793E4CF6_AdjustorThunk','_FixedListByte64_Equals_m8BB703D513781232586E78033F344CCE73D1E513_AdjustorThunk','_FixedListByte64_Equals_m284C2F00AB00789F521641E5D5F3CD62EFB4B20D_AdjustorThunk','_FixedListByte64_CompareTo_m9116C77AAE5EC2639A67BB76FF6FB424D8E5DE3C_AdjustorThunk','_FixedListByte64_Equals_mBFB761C74FEA9F9F856666137788903D064BF829_AdjustorThunk','_FixedListByte64_CompareTo_m34CB7567CBEFD90CFB277DD4523A893CDE1CEBE5_AdjustorThunk','_FixedListByte64_Equals_mCBD9D96AFFA516CF8E9D12189FBFD667915D2B48_AdjustorThunk','_FixedListByte64_CompareTo_m561BF8E84AC9C57BF99A5514A270A1AEFD3B1F67_AdjustorThunk','_FixedListByte64_Equals_m9B70A99C8174C8AAD5B073E877EDCC175B6B6B2C_AdjustorThunk','_FixedListByte64_CompareTo_mA07C384FB547703B52A38D1504C5E8B8DC3CE9F4_AdjustorThunk','_FixedListByte64_Equals_m0D0FAAD74299439D628AF010864BC8DEA9355779_AdjustorThunk','_FixedListByte64_CompareTo_mDA1046C598AC3DE766CFDC445058FE4EE5D7B9E3_AdjustorThunk','_FixedListByte128_Equals_m7A2E084E4FBFB86857E0AE4639249C6C3006AF92_AdjustorThunk','_FixedListByte128_Equals_m8B38AAFCC71B4ECE7206D6A4D83E54D3FCCB99BB_AdjustorThunk','_FixedListByte128_CompareTo_m4FC9BE04CDD252F05E005C564AE0758A2CF75BCF_AdjustorThunk','_FixedListByte128_Equals_m2E607C17729E65DA9489168F8F6F1BEDF562988C_AdjustorThunk','_FixedListByte128_CompareTo_mB57F74050519BB5C7D4A774BB057E7FC4BC56CEF_AdjustorThunk','_FixedListByte128_Equals_m8875A9D1A77A789005CADCC230749095398A2073_AdjustorThunk','_FixedListByte128_CompareTo_m88DCF6686E2E1D17DF99A71CF11B22C0834E8894_AdjustorThunk','_FixedListByte128_Equals_mB0834997639E3DAA074C5AE71E8CC7ADD6906B0E_AdjustorThunk','_FixedListByte128_CompareTo_m5129E631C85500E85A86D6DD2E10E458B605C228_AdjustorThunk','_FixedListByte128_Equals_m4B1B6BA5FA385E8904965639319AFE3481058729_AdjustorThunk','_FixedListByte128_CompareTo_mBD4C328F5D288F6C30CA11530A9DC97672C082C0_AdjustorThunk','_FixedListByte512_Equals_m7ACF112A65CB2709260F002FF86BCB822406E9CA_AdjustorThunk','_FixedListByte512_Equals_m3950790CD984553BDC09A0EEB169FCE6979FB679_AdjustorThunk','_FixedListByte512_CompareTo_mF22C7FE00CDBBB4ECE693F664178EA4A40E65AE6_AdjustorThunk','_FixedListByte512_Equals_m8555DF2ACEA11ECDB9F07419FCB4EA04466EA837_AdjustorThunk','_FixedListByte512_CompareTo_m2A2E3750881817D4FDE767AA7E2A9D60B0CD5C9A_AdjustorThunk','_FixedListByte512_Equals_m54A6B28345FDA7AF24C4090AF17DEE3531601CDB_AdjustorThunk','_FixedListByte512_CompareTo_m324EE3CA10080EC4BEA3432AE8FB0E0BBE8FF9AB_AdjustorThunk','_FixedListByte512_Equals_m8FDB9224E90B977C02B3DBD51110942B532044CE_AdjustorThunk','_FixedListByte512_CompareTo_m9DB836C7A97C46F403360CDA5A4B73B4FDCDB7FD_AdjustorThunk','_FixedListByte512_Equals_mB444B8EA8D688B9D34555B9BC7D319D4F66D824F_AdjustorThunk','_FixedListByte512_CompareTo_m27789FF39C0A03A3FFDD7BE0035836B7BFA6A7B5_AdjustorThunk','_FixedListByte4096_Equals_m6174A0D14CA41D72246EE48849EBA97164910AB1_AdjustorThunk','_FixedListByte4096_Equals_mDD89E585538BB28CB81D0F4A68AA0B7EF51ADE3B_AdjustorThunk','_FixedListByte4096_CompareTo_m3438F045975C32CD30F579419415EDE51F3930DB_AdjustorThunk','_FixedListByte4096_Equals_mFD99A952C5C6A6D32B373799354F592861B005D7_AdjustorThunk','_FixedListByte4096_CompareTo_m4C59956AAE3C56F2F1DA00F2C4E6FC1B9C6413AD_AdjustorThunk','_FixedListByte4096_Equals_m5B9D443C998D4DB177732CFAE994AC74D0FEDAEB_AdjustorThunk','_FixedListByte4096_CompareTo_m6B234EF2C9AE9A2CFADED0BB5EA016424E90AC0C_AdjustorThunk','_FixedListByte4096_Equals_m59A31FAD33C8BB5B97066397C44F0A942B1BE928_AdjustorThunk','_FixedListByte4096_CompareTo_m7E667C785FDFD6C818AC8752B387AA9EFC323B96_AdjustorThunk','_FixedListByte4096_Equals_m4A2193C93FB9F0F2D0B4F027E3B67FE229731A23_AdjustorThunk','_FixedListByte4096_CompareTo_mC889B8283431E80C3FF0402334FEA4DF95ABA04C_AdjustorThunk','_FixedListInt32_Equals_mBC0D4A2CDC049B6181026583694A188BC0723D8A_AdjustorThunk','_FixedListInt32_Equals_mB0A79E79A60EBEF2172A3C92553C7AFAF68F318B_AdjustorThunk','_FixedListInt32_CompareTo_m52FAE2289C7BB8A4556FFA6E91D10FC321B608CA_AdjustorThunk','_FixedListInt32_Equals_m1DF22F03CC6645FFCC78FC971F6966222A1424F3_AdjustorThunk','_FixedListInt32_CompareTo_m2DAC1F75A776181909F0FAAD98BF264B9558E440_AdjustorThunk','_FixedListInt32_Equals_m63AD9541069C0BD56EF820396B0F3A1A5650EE54_AdjustorThunk','_FixedListInt32_CompareTo_mC67156313AA92EBED1C29433F4148E7C520350FA_AdjustorThunk','_FixedListInt32_Equals_mC4F93198FB953453E1ACAE4330CF91754954B43E_AdjustorThunk','_FixedListInt32_CompareTo_mFC3AD48D7632B89549822A38CA06BA71E5DF9252_AdjustorThunk','_FixedListInt32_Equals_mB42FF686D8535FCA7DB837B3F073B05FFC7D5259_AdjustorThunk','_FixedListInt32_CompareTo_m173D29D483C252294BDFD0A50067C7A083CB4A52_AdjustorThunk','_FixedListInt64_Equals_mA254E5DD5445D105DA19C84E057D7B6D9E569DCB_AdjustorThunk','_FixedListInt64_Equals_m9811546E36424B32A3ECD85052D4A8B4B989241C_AdjustorThunk','_FixedListInt64_CompareTo_m7B82FB292C727D4900B3BA3C6FB2E75CBAC52D3D_AdjustorThunk','_FixedListInt64_Equals_mE6A4CE6E09F2B7542D70A50F3BCEBAA5BBDF22E2_AdjustorThunk','_FixedListInt64_CompareTo_m96E077BE811DAC3CA0AE571DD433F4E324480B5A_AdjustorThunk','_FixedListInt64_Equals_mE493D86F316E87BB70BBB92A30A3A13234CA0C8B_AdjustorThunk','_FixedListInt64_CompareTo_m27F4EFBBC92DD7BCE40424611EEFF0B1030A8900_AdjustorThunk','_FixedListInt64_Equals_mC203D3BF7D483BF2940A3E5E38144D06876CE49A_AdjustorThunk','_FixedListInt64_CompareTo_m55E519E0B56A5DD179C8F4C69AE64F050BC47F6F_AdjustorThunk','_FixedListInt64_Equals_mB1E8DB62C0C8B3FE47BF6279508DC0BF195D5B5C_AdjustorThunk','_FixedListInt64_CompareTo_mD895AF61F1568095C59C4230A58616E9E69F5D5C_AdjustorThunk','_FixedListInt128_Equals_m49746341F9CB1A0BA54D73664B60EFAA9686D467_AdjustorThunk','_FixedListInt128_Equals_m84AE825E63E28CDCC3BDA7E581CA4CDE26C61CD3_AdjustorThunk','_FixedListInt128_CompareTo_mD56A9EF5D7D95548F337C71A2FB4C8B4A4D7A427_AdjustorThunk','_FixedListInt128_Equals_mB5A3187F2308570776A8BC26126D25034D192CD4_AdjustorThunk','_FixedListInt128_CompareTo_m75BA66C0B46E5EB4ED80E7F82671B02FA0FFF343_AdjustorThunk','_FixedListInt128_Equals_m0A0EF6892FCDCCC45DABABD2D0A71BEF54D2E05D_AdjustorThunk','_FixedListInt128_CompareTo_m7AF45DAEB7CA9F8EF0EFC303E56D7FD4212DE0E7_AdjustorThunk','_FixedListInt128_Equals_mB7DCD4F67B2BCB3D0F94B4AF8E9472FD981A0B22_AdjustorThunk','_FixedListInt128_CompareTo_m2A68B7B15E79ECCBC5D5E7132AA98983D685DEFE_AdjustorThunk','_FixedListInt128_Equals_mA4388F7A42B223F589A2EFED7DD5471EFD9E8A35_AdjustorThunk','_FixedListInt128_CompareTo_m85FD0AF4D924EE3452D35E9BA4C3765F65B69709_AdjustorThunk','_FixedListInt512_Equals_m0400955DD18674FE57BFE5CDCF893FC2C6A2E855_AdjustorThunk','_FixedListInt512_Equals_m64A27811FB1D5E20294A27F5476A784363CFAB0E_AdjustorThunk','_FixedListInt512_CompareTo_m52CDE3A2E48A9CE18B3E6948E511109D8CFD9182_AdjustorThunk','_FixedListInt512_Equals_mEDA05844E991E52827FC8F160348F113658AB2C0_AdjustorThunk','_FixedListInt512_CompareTo_mD5A95B9B84EE9568DE0A99555A4A94B5AFBE8180_AdjustorThunk','_FixedListInt512_Equals_mCDD7034E8D418B4AAAF9B20A5F26E357FD465D2D_AdjustorThunk','_FixedListInt512_CompareTo_mC5657808BA322C76A15F9299B45CE95E948FBBA3_AdjustorThunk','_FixedListInt512_Equals_m2335E33F8C168B8D4387F8472341A545ABA3BB82_AdjustorThunk','_FixedListInt512_CompareTo_m67B4FA95AD97EA013B37691FB9C92FDD2DB08A8E_AdjustorThunk','_FixedListInt512_Equals_mF970EE1D48464E67A0FBADB2BDA314D95062D35E_AdjustorThunk','_FixedListInt512_CompareTo_m3C2CB3FEBE8F20C7EEF139CB21B9A328E4A5F834_AdjustorThunk','_FixedListInt4096_Equals_m05C6AC891A2D88D4D2D75821EBA59332DA948416_AdjustorThunk','_FixedListInt4096_Equals_m71409D4AD54F40C9623E37B7E1D806539301183A_AdjustorThunk','_FixedListInt4096_CompareTo_mF030DA7FC9500A849DE71051B44751D928E81BAC_AdjustorThunk','_FixedListInt4096_Equals_mCFFF319D9BEE4F3D3E5064D70E0F00B8D2B9C7B3_AdjustorThunk','_FixedListInt4096_CompareTo_m12A5DF91380AE9BFD6DFB812907E3D8CCC5EB000_AdjustorThunk','_FixedListInt4096_Equals_m5C4B02A971418DD29E244E57484E12A1A9CEC293_AdjustorThunk','_FixedListInt4096_CompareTo_m84BFC1A8EFB213FA3CE2D60254002264B2F68711_AdjustorThunk','_FixedListInt4096_Equals_m60A95892D070E9E2733C0C1208689EBE312680E5_AdjustorThunk','_FixedListInt4096_CompareTo_mD685720D4DA4BE70F7976FF1134E6673C3E5388F_AdjustorThunk','_FixedListInt4096_Equals_m184E6ADD7FDBBAEAE87FCE0094EFE24BADB1B2BA_AdjustorThunk','_FixedListInt4096_CompareTo_m1ACC60D5C6CD47295D36988978E450E9AEF4A61D_AdjustorThunk','_il2cpp_virtual_remap_enum4_equals','_NativeString512_Equals_mC5C459E3D016F3700ED0A996F89AA0288C6D4074_AdjustorThunk','_NativeString512_CompareTo_m359B652FB19E397A83121085E8DBD493AADF2606_AdjustorThunk','_NativeString512_Equals_mCF1E64EED1A677B16B3C60481051EE7897AF1EDD_AdjustorThunk','_Color_Equals_m9BAA6F80846C3D42FD91489046628263FD35695E_AdjustorThunk','_Color_Equals_m4BE49A2C087D33BAACB03ECD8C9833AB1E660336_AdjustorThunk','_Entity_Equals_m8B9159BC454CEA2A35E9674B60B3CEF624F5C6F3_AdjustorThunk','_Entity_Equals_m2739CD319AB17A7318B7DF9D29429494E6036D01_AdjustorThunk','_Entity_CompareTo_mBA83E2FCC310A03CA53B7E2580C1CE5F9101B58C_AdjustorThunk','_ComponentType_Equals_m97C28B3743F1C228712C0E775D952BA181A997E4_AdjustorThunk','_ComponentType_Equals_mB92EC274A59380214CA9BE66B61532AAFF2F5F72_AdjustorThunk','_NativeArray_1_Equals_m2C603577039C36A0F6AEDDCA4BF59FC7515CEA91_AdjustorThunk','_NativeArray_1_Equals_m14F469C172601BAC02633305BF52F33D83E2D1E1_AdjustorThunk','_EntityQueryBuilder_Equals_mBC180CB5BB4B5687A65496C86ACF116BEE5E4325_AdjustorThunk','_NativeArray_1_Equals_m6F5978892D485FD36AEC1F90CFD5AB5466934B17_AdjustorThunk','_NativeArray_1_Equals_mDA52F2A42E9115CAEDD06E8F93B22F4F7D753EFC_AdjustorThunk','_Scene_Equals_mE2C85635DAE547EA1B63AEA7805B006D7D0C4E93_AdjustorThunk','_Scene_Equals_mF5A38E847AD1BD6AF0A3F4D140A4486E10A34A19_AdjustorThunk','_SceneGuid_Equals_mDEF0B9DA1FAABDC9EDBA6AE4FE9793A5B9DA2CFA_AdjustorThunk','_SceneGuid_Equals_mB22F600C66019AC5805763DD7A0B5D8F6D78C381_AdjustorThunk','_EntityGuid_Equals_mDFE00740AF93F8287164B0E268E1816E00FBFDED_AdjustorThunk','_EntityGuid_Equals_m1BF7F17598B3CDE5454CB7295B5AD78BD047CCC4_AdjustorThunk','_EntityGuid_CompareTo_mEDEFCFBCAF4D468B3FA58B11C3C92A51BF68BC7C_AdjustorThunk','_SceneReference_Equals_mBB4A710D9D4B79A5853484BAF0941AA10C5635F6_AdjustorThunk','_SceneTag_Equals_m3EFAF1C15796A3A5E0EB6D30A42DAE783F8C8A24_AdjustorThunk','_SceneSection_Equals_m94C65474CC395168100176CE8E31F4CBAD124CC6_AdjustorThunk','_SimpleMaterial_Equals_m4BFED00024CB1D0E65DCEEA2B358329C729D7637_AdjustorThunk','_LitMaterial_Equals_mF674981FA2EDCC1514DA77F89A74ADAC21FF6AED_AdjustorThunk','_BuildGroup_Equals_mE8181934EB50B4F5F184E9F27D29BFB83FC1A41B_AdjustorThunk','_SortSpritesEntry_CompareTo_m4CEDDAA899EDFE33AA4E17AE29575D014CC3FF0D_AdjustorThunk','_EntityArchetype_Equals_m6DD973EED29BF29894D6C4758F06F304F9B40322_AdjustorThunk','_EntityArchetype_Equals_mF4919F60F03979435FC6A009C807231C4F39D815_AdjustorThunk','_EntityInChunk_CompareTo_m77C233D22BA7265BA0CB2FAFE346264E4890F37D_AdjustorThunk','_EntityInChunk_Equals_m2C322B7C39EA488BADDBD6A35AF7F146F243879C_AdjustorThunk','_ComponentTypeInArchetype_Equals_m55D46DCBEAC64BF2703ED99BFC6DFF51BBACF97F_AdjustorThunk','_ArchetypeChunk_Equals_mB60BAA8621FA93E12D76B156DB1F5F059009AD5F_AdjustorThunk','_ArchetypeChunk_Equals_mC90EE0E63C788B66064CEA02BF1BE20348462EEC_AdjustorThunk','_BlobAssetPtr_Equals_m1D07B3C19EB26C534A5058AD6A8335E0F3C48391_AdjustorThunk','_BlobAssetPtr_Equals_m02270937419C556F4CD01A6769297BB24F847D16_AdjustorThunk','_BlobAssetPtr_CompareTo_m07718073C78567CEAF2E5F8D6DF07E98481D17F1_AdjustorThunk','_GetSystemType_1_Invoke_mC31AE81E53C46EF4F869E1C77839A9AC24EFF6B2','_NativeArray_1_Equals_m20C38F6A75248F77D80270E1C050210A347F8062_AdjustorThunk','_NativeArray_1_Equals_m138F528F1DA338FDE900A41B22A2B70FA921BC5F_AdjustorThunk','_NativeArray_1_Equals_mFE3C41BFB546290B87BC249494197B04C1E489F5_AdjustorThunk','_NativeArray_1_Equals_m8FF53D6C9FCF8C6805FE8F369835EAB58A797C11_AdjustorThunk','_Hash128_Equals_m10DF98E630E98B91BBFAAD9DDF4EDB237273A206_AdjustorThunk','_Hash128_Equals_mC53374D67521CD5C4413087C1F04880D870B2C34_AdjustorThunk','_Hash128_CompareTo_m56E2D65F12FEAE043EA9753C8F1D99DB480EE0FA_AdjustorThunk','_NativeArray_1_Equals_m61C847C1DF82DFAE7E19C9A1052C7F5F63A8C204_AdjustorThunk','_NativeArray_1_Equals_m04BD836026DC15B22B18F02E6CD0CFBB3CED0CEA_AdjustorThunk','_NativeArray_1_Equals_m29FD5DF54C0B9C122C02090F2ED6A51B0D196C53_AdjustorThunk','_NativeArray_1_Equals_mA3E07504A9005D82099F06C11883ED72BD6B9B4F_AdjustorThunk','_NativeArray_1_Equals_m302B6BEF84C12946BC013C0EB702A0607BD59727_AdjustorThunk','_NativeArray_1_Equals_mEB3D93FD63E738951F5B4441BFD615EF36BBA038_AdjustorThunk','_NativeArray_1_Equals_m5429614F2C316D010ED567A94A866CFCABEB1CDF_AdjustorThunk','_NativeArray_1_Equals_m8419BFE73AEA8FFB1AFF79EC6F63C71BB027DFC2_AdjustorThunk','_NativeArray_1_Equals_m70013632FB1602568F08D581673EBB507E58C449_AdjustorThunk','_NativeArray_1_Equals_m08D9357DE42B3F2DE6211557CED05663990B4C7A_AdjustorThunk','_NativeArray_1_Equals_m8F22E0D94A50B4C0E0CF99E4BF1F259A679D582F_AdjustorThunk','_NativeArray_1_Equals_mDD8832E25E2DD70294B9C7303DABEE2DB4C6B71A_AdjustorThunk','_NativeArray_1_Equals_mCDD378D700D08029AADA61E3F229CE99265770A1_AdjustorThunk','_NativeArray_1_Equals_m36DD9DEB6A4FACD2F36628066E713EFE9CDB915B_AdjustorThunk','_NativeArray_1_Equals_m9E4DC18C694A1521C33804261012E4B7B14E6E23_AdjustorThunk','_NativeArray_1_Equals_m71D3AF07E96DDFCD2A7BBE31D156646F58D7F9D7_AdjustorThunk','_NativeArray_1_Equals_m46A64D4607FA37FF8EFC03995F8DF015F3E02F53_AdjustorThunk','_NativeArray_1_Equals_mA70C5F0D468D32970AF71DD6A3163C9C2693169B_AdjustorThunk','_NativeArray_1_Equals_m0EDA2DDFCC16C418A749226A8E201EDC51FEDE78_AdjustorThunk','_NativeArray_1_Equals_m16E71A7C2FED272F48BD5850C2DCE0C1E7611763_AdjustorThunk','_NativeArray_1_Equals_m109FBF86AAB3AD66F7EF45A80B126CB7ACBC9C4D_AdjustorThunk','_NativeArray_1_Equals_m34FC1C4D8857A510CE07BB266F3F16FE898C236B_AdjustorThunk','_NativeArray_1_Equals_m8F9BEB1BE5E806C3E1D054864B6657CD83F0AF52_AdjustorThunk','_NativeArray_1_Equals_mEB4FFBD00BFBC22ED45942BCA87CF69466966CBD_AdjustorThunk','_NativeArray_1_Equals_m65664CCC3C664FF015203FFC77CA1F1DDB8E75B7_AdjustorThunk','_NativeArray_1_Equals_m9E9A4E44C4876D66E8C5B75BA1B4B55C1E4CC79D_AdjustorThunk','_NativeArray_1_Equals_m465B5C9980FD5988C52C0CAEDB4C170B2D604063_AdjustorThunk','_NativeArray_1_Equals_m63E232C26B8571BB3C0B58EC19BB50ACA24048F3_AdjustorThunk','_NativeArray_1_Equals_mCB79EEA0941A6FEEFDB5260C67CBB702E4C8B2AA_AdjustorThunk','_NativeArray_1_Equals_mCBE6FE615AF57BB563F3C13817B56F35B23E1B6A_AdjustorThunk','_NativeArray_1_Equals_mABE64DCD2C1B48926067ED675A3CD5BAF5B0D9D4_AdjustorThunk','_NativeArray_1_Equals_mF446F7698AD056B12E7540640ADDAA680DBC4625_AdjustorThunk','_NativeArray_1_Equals_mEE0586D6AFAE2543EA9656C60E07AA9B551BFA2D_AdjustorThunk','_NativeArray_1_Equals_m7ECCC4E4D200B9E49AD01FBE7FDBA2BD83DB84DC_AdjustorThunk','_NativeArray_1_Equals_mD98309B56895C56125EA6C4859BB4AABF2944D66_AdjustorThunk','_NativeArray_1_Equals_m180CA579EFD304F7BF2EF9A67CAA79E21913CDCA_AdjustorThunk','_NativeArray_1_Equals_m634EC99EA48FB36A253CAC9045E3FE83669BB987_AdjustorThunk','_NativeArray_1_Equals_m0102B3DFFD16F855396102F29E1E5B97A48A5958_AdjustorThunk','_NativeArray_1_Equals_m7F1A0E855A345207A2AB5BFC959047B578F89B9E_AdjustorThunk','_NativeArray_1_Equals_mD85EBCFD97AF167D7E509FC874FDA20F0FE75AB5_AdjustorThunk','_NativeArray_1_Equals_m3326BC381D0E8787AABF2BA935C6F3C04FF5CC2C_AdjustorThunk','_NativeArray_1_Equals_mEAEFE1D366CB8692FEA3EAAB36C80617BAF07295_AdjustorThunk','_NativeArray_1_Equals_m05E088BB65A9985D7944269E745C44F3041266AE_AdjustorThunk','_NativeArray_1_Equals_mEADD0B1048DFF2F66A5C885DC05AE98208FDB1F6_AdjustorThunk','_NativeArray_1_Equals_mBDD98800EB0FAC6E6D821FD96C1ACEDE4F9A3A29_AdjustorThunk','_NativeArray_1_Equals_mA42637D8522E7E6E4AF28000378932BAF253918D_AdjustorThunk','_NativeArray_1_Equals_m1C914426A82AA3DAD6C5E4618F35572DC2C93264_AdjustorThunk','_NativeArray_1_Equals_mDDDB11149E7FBDC7B34AF912E57A077B58C0AC20_AdjustorThunk','_NativeArray_1_Equals_mE8E8C56D9697A19AB74B5A56DF82AC7631544392_AdjustorThunk','_NativeArray_1_Equals_m866DCB599B1C5A8681BEDD083FF0673CD602FE13_AdjustorThunk','_NativeArray_1_Equals_m6F060D8A3C6D6C80A8E15B3D448D7C0F92676CE0_AdjustorThunk','_NativeArray_1_Equals_m8ED5E128A607728384EF076AEEAFF6A49F9CD2A5_AdjustorThunk','_NativeArray_1_Equals_m6E21779CEB29C5B8A204F39FCE447A5551A74591_AdjustorThunk','_NativeArray_1_Equals_m3BD1DBAB196A2E2BEE799A860409C7C78254931F_AdjustorThunk','_NativeArray_1_Equals_mD4D2878F875FD067287C72D60655F75A574AAA62_AdjustorThunk','_NativeArray_1_Equals_m16B9A37038845EDE94C802F52EFB3E0ED280BE64_AdjustorThunk','_NativeArray_1_Equals_mC3FF5CE9A3F7E0C0517D20795529F7E51384E6B6_AdjustorThunk','_NativeArray_1_Equals_mCDCC4AD45CBA57C01209210B8D48EA196E4DF9D9_AdjustorThunk','_NativeArray_1_Equals_m25A863D16C80CCD7A13D64AA5EC32478C7B022F6_AdjustorThunk','_NativeArray_1_Equals_m6E85279C42ADEA094339D705C23D452D524107FB_AdjustorThunk','_NativeArray_1_Equals_m0E7F184F1B35507D6890C3CE15E653EFBDDB8C30_AdjustorThunk','_NativeArray_1_Equals_m4179D7C3672BF920522D2E2AE8335168802EC8AA_AdjustorThunk','_NativeArray_1_Equals_mDC0C94074BC53D9AB5CD667536C3F760E371FC1C_AdjustorThunk','_NativeArray_1_Equals_mC201B11F4CB763D4C71A2A26FAE351C418E437D5_AdjustorThunk','_NativeArray_1_Equals_m89E2B5D9750DD50DBD9BCA13E5D0B0CBBDC88DA2_AdjustorThunk','_NativeArray_1_Equals_mB31271DCAF23199AE592A2BE10D9ECE5493673AA_AdjustorThunk','_NativeArray_1_Equals_m84AAD28358C891EC5A776355155F1E4B607EF253_AdjustorThunk','_NativeArray_1_Equals_mB22AC261C0A509CE9590208A23BEFE57CC963146_AdjustorThunk','_NativeArray_1_Equals_m0EA7B4D86B22A0547E2B1437F4932BD9F7235036_AdjustorThunk','_NativeArray_1_Equals_m4A7EEC3B5236D79DE72AEDC4D33AD5B4C2AE747A_AdjustorThunk','_NativeArray_1_Equals_m684E91BEA6753963A4DC31EE972BC0F181F59D8F_AdjustorThunk','_NativeArray_1_Equals_m6A29F1B6B0200C9CB7A30F30B44080DCA04C80F9_AdjustorThunk','_NativeArray_1_Equals_m430DBA74CE28A604EEEEFFB7536B83ADE0E4420B_AdjustorThunk','_NativeArray_1_Equals_m41CE94F72C9BBD5242F5C9A976A2AD319A6B16A4_AdjustorThunk','_NativeArray_1_Equals_mC1F22D61B4A9844884C39CB50C193B1CCE130E4B_AdjustorThunk','_NativeArray_1_Equals_m28FBB24A2551D32DD1D55B962EABB52152C715E4_AdjustorThunk','_NativeArray_1_Equals_mFCE3E8C1E5D1765221E5A0CECBCACDBFA8FE8EBF_AdjustorThunk','_NativeArray_1_Equals_m29AE43209572F1E31C00E00B1931EF43577BF083_AdjustorThunk','_NativeArray_1_Equals_mFCF113D15309804F7FAF1C3D9216AF46895C03BB_AdjustorThunk','_NativeArray_1_Equals_m4BAB0F6585E6B21500329FB8379C52DF16E6C915_AdjustorThunk','_NativeArray_1_Equals_m68DBADA2F56FC6C93C36A522177919965E2BC1D4_AdjustorThunk','_NativeArray_1_Equals_m2DD844494CE8FED987B102799A5AE23F88C950D4_AdjustorThunk','_NativeArray_1_Equals_m3D5DFA9CBF13D6999C0F76C65D6CFFBC56E5D043_AdjustorThunk','_NativeArray_1_Equals_m94D9AA016BE648544AD3E275594DE7E65C3F5E40_AdjustorThunk','_NativeArray_1_Equals_m4F4E4F67B0141A25287D6B1FBF083F8E29B138E4_AdjustorThunk','_NativeArray_1_Equals_m7AC409271E98B461D2DFA15E88CA02BF90C7078C_AdjustorThunk','_NativeArray_1_Equals_mE0273AA92D66A9DF58A570E17693E3D2BE34B909_AdjustorThunk','_NativeArray_1_Equals_m0E4F066CA59C260945B6852EE21B23DB10D4392B_AdjustorThunk','_NativeArray_1_Equals_m847DEDD8C2289218E6099DB3EB565A49BC493CAE_AdjustorThunk','_NativeArray_1_Equals_m51522AA95B9F245AFC01B567A97F139D6C7C0A94_AdjustorThunk','_NativeArray_1_Equals_m22B62B2E97176C6838F9B25D9B83098FCF4DC396_AdjustorThunk','_NativeArray_1_Equals_m0FDB10203BF53CEC4D9503934B7CBD5B275CA237_AdjustorThunk','_NativeArray_1_Equals_m2FB719155EB3934F505ADCDB7E04D3AE57EF7C10_AdjustorThunk','_NativeArray_1_Equals_mD8FEC1EF051B083DD6EF49189A67D22EDFFA7484_AdjustorThunk','_NativeArray_1_Equals_m42284045ABE3CAC6CD920DC1CC383D1DB3405F73_AdjustorThunk','_NativeArray_1_Equals_mE0192B29CEE31ECEDC59D585B164C8F2B893E87B_AdjustorThunk','_NativeArray_1_Equals_m7B2963691162B9FEE2F0D43F0566E48B4EE4F83D_AdjustorThunk','_NativeArray_1_Equals_mA8966DEE57A1A9450A7494EB68319F5936A0B99F_AdjustorThunk','_NativeArray_1_Equals_m56139F4357F0F1D79D90284D0CABC00D541FD30A_AdjustorThunk','_NativeArray_1_Equals_m5D6D2FAB26E4AC48D272FF0BD1C5956F323E49D4_AdjustorThunk','_NativeArray_1_Equals_m80A1F1BFD6E35D70CC67779E5C72994E3444B6E4_AdjustorThunk','_NativeArray_1_Equals_m80F044B9A482F8558FDE7D4AFAAAE05EE522806C_AdjustorThunk','_NativeArray_1_Equals_m41DBD84EA2954500475D252835B06E5F1B452B28_AdjustorThunk','_NativeArray_1_Equals_m998DD9340E84E892A67453B5F6C58CCCEB21087F_AdjustorThunk','_NativeArray_1_Equals_m022FB0F3788C6DE733C512287F026ADD22DB3DE5_AdjustorThunk','_NativeArray_1_Equals_m911162F0567EADC1E61E3137BF92D5FDD041020B_AdjustorThunk','_NativeArray_1_Equals_m05E3D5E1D5C14635E8BC6A0A0033DB80242521A8_AdjustorThunk','_NativeArray_1_Equals_mDEDCE25F5A57EA3217746E78D9FE8C859BE617BC_AdjustorThunk','_NativeArray_1_Equals_m76FDCCC93AA4D257AD9B46F0B0928B6C601AB848_AdjustorThunk','_NativeArray_1_Equals_m59FDE4E93FBA7811549D4A3E5359E7C758F73C2F_AdjustorThunk','_NativeArray_1_Equals_mE06E8943B63619BDD07D77B121592ED443F7506D_AdjustorThunk','_NativeArray_1_Equals_m2F6911DB3D694C323994F21CD59D7645E89EC101_AdjustorThunk','_NativeArray_1_Equals_m2204567A5BB0F5E6829520D66ECD199B1D3E7E19_AdjustorThunk','_NativeArray_1_Equals_m1D08B465457EDF45F1135192057C5ED036956269_AdjustorThunk','_NativeArray_1_Equals_m26A335E88D619954A3F35DA5E1C708BD27375B30_AdjustorThunk','_NativeArray_1_Equals_mDC4050DA281FAD3AA5FF2135E1561E6464CE0F49_AdjustorThunk','_NativeArray_1_Equals_mB93BCE5B37BF99DAD0F42C77B469C5058D7082B3_AdjustorThunk','_NativeArray_1_Equals_m82DE73F5C90393B95C35B080F324A0E14671D5F8_AdjustorThunk','_NativeArray_1_Equals_m7923EAFE69C4811E2802FB5DAEE26DB0ACDA5848_AdjustorThunk','_NativeArray_1_Equals_m635BD473F062B64840B9E83A19A37F704168DB4A_AdjustorThunk','_NativeArray_1_Equals_m28EE88C53C8CCEF40EAB50C7BB5989101DB1DC7C_AdjustorThunk','_NativeArray_1_Equals_mE4A9286208F75F8640FD74543DCA831D10CAC348_AdjustorThunk','_NativeArray_1_Equals_m658A996A61D91F4626659A0F0E7006685DC21011_AdjustorThunk','_NativeArray_1_Equals_m6B57A0275A873980836193B3F21644397571D52B_AdjustorThunk','_NativeArray_1_Equals_mE0F0C41D4F2A1455C439C6616849A62B25BA18F9_AdjustorThunk','_NativeArray_1_Equals_mBD47ADD9C83D1ACEBE2F7E5A61273E1C43CD5E20_AdjustorThunk','_NativeArray_1_Equals_mFA9A6A0C999E5D18918DECBDC16C7C03AF7F75E5_AdjustorThunk','_NativeArray_1_Equals_mF852F8F384EC0659729BFEB7323AA6C1CBC1AB79_AdjustorThunk','_NativeArray_1_Equals_mA605491D03C6724D66656DABF63AA0CCFF5345AE_AdjustorThunk','_NativeArray_1_Equals_m8A472872AD97B3302940AF187FCEEE99128B2D4C_AdjustorThunk','_NativeArray_1_Equals_mB82BBA7E4F83D9C63140620A74D23267D7791C38_AdjustorThunk','_NativeArray_1_Equals_mD14FD0F9F418B32EB0117C5CD2D6367734DAC701_AdjustorThunk','_NativeArray_1_Equals_m1147DA88E9FB1832E8F39CBDC6A78D1613404257_AdjustorThunk','_NativeArray_1_Equals_mD3EBBB8F443222DF2F1D900E190D20ACEA73070C_AdjustorThunk','_NativeArray_1_Equals_m4A735EC55B7D446F7C62F4BB22396268B234E7D3_AdjustorThunk','_NativeArray_1_Equals_mCF3EF20658AE570335D55098D8E85611C2E3AA60_AdjustorThunk','_NativeArray_1_Equals_m517137176B5D08881E17291B80AF84F66A2EED29_AdjustorThunk','_NativeArray_1_Equals_mA13E47B761A7A9CD4FF68D226AB20706AC05F50C_AdjustorThunk','_NativeArray_1_Equals_m36866073359E4373E7DA6E6C7931C8A88E4828EB_AdjustorThunk','_NativeArray_1_Equals_m2F44DB4A98CD5E3DBE5D2DA2B5294A6BBC0BE885_AdjustorThunk','_NativeArray_1_Equals_m0DBEBFDE1E6EACA27DFA058EAF10791A155E5A0A_AdjustorThunk','_NativeArray_1_Equals_m3C60F133AE37A291B6FF38EBAB34F861854247FC_AdjustorThunk','_NativeArray_1_Equals_mA6721EF9497AAA65A695C81D8001A59204EB9158_AdjustorThunk','_NativeArray_1_Equals_mF836D8B9A60C953D46F512134BF7141BC83D8729_AdjustorThunk','_NativeSlice_1_Equals_m3B497EE67C514347FDABE033886F616E0269C727_AdjustorThunk','_NativeSlice_1_Equals_mECE905552C094B1EBE1F37F330F64ED88932506C_AdjustorThunk','_BlobAssetReference_1_Equals_mE3BCC6F0F05ACBF6869568412E02B9BB330DB275_AdjustorThunk','_BlobAssetReference_1_Equals_m22F621339740DD3D632EA902EE09EA1844300514_AdjustorThunk','_BlobAssetReference_1_Equals_mDDC62B46E4CD92841966C6C33BDF143B8D0D6253_AdjustorThunk','_BlobAssetReference_1_Equals_m7AF5196AB20F0C1F1DB110ED152BAF70617FF776_AdjustorThunk','_BlobAssetReference_1_Equals_m7AEAF0782B3895E1351BEE580B54C1C6301AA467_AdjustorThunk','_BlobAssetReference_1_Equals_mBC18D11B998D0129480EFD84D09280AF71900409_AdjustorThunk','_BlobAssetReference_1_Equals_mABDBDA392EB844DC69C334CEB200B4D448ACACD3_AdjustorThunk','_BlobAssetReference_1_Equals_mF6B5CC0CC40C9AA68811FBC41AB06C03D0856C6C_AdjustorThunk','__ZN4bgfx2gl17RendererContextGL11getInternalENS_13TextureHandleE','__ZN2bx17StaticMemoryBlock4moreEj','__ZNKSt3__219__shared_weak_count13__get_deleterERKSt9type_info','__ZN4bgfx4noop19RendererContextNOOP11getInternalENS_13TextureHandleE','_U3CU3Ec_U3CSortSystemUpdateListU3Eb__17_0_mEA566F8387BEC9AFEF5B817B9E6940C5C00FBFA3','__ZN4bgfxL17compareDescendingEPKvS1_','__ZZN7tinystl4listIN4bgfx17NonLocalAllocator4FreeENS1_16TinyStlAllocatorEE4sortEvENUlPKvS7_E_8__invokeES7_S7_','_emscripten_glGetAttribLocation','_emscripten_glGetUniformLocation','_emscripten_glGetFragDataLocation','_emscripten_glGetStringi','_emscripten_glGetUniformBlockIndex','_emscripten_glFenceSync',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iiii = [0,'_Int32_ToString_m6B210A3563C22C0640F05004791AFFDAF9D715A1_AdjustorThunk','_Double_ToString_mB1A3F7A4412911158D222E8255D5CEA28C9B7151_AdjustorThunk','_UInt32_ToString_mFAA119806993132F73BB2977F26E129A2D09D66D_AdjustorThunk','_UInt64_ToString_m1F7EDB4BAE7C1F734ECA643B3F3FA8350237A60A_AdjustorThunk','_Guid_ToString_mA9FF4461B4210034B6F9F7420F1B38EA63D3319C_AdjustorThunk','_SByte_ToString_m5E4FEAA7BD60F4D7C2797935C7337166579AB290_AdjustorThunk','_Byte_ToString_m1354398A7B093824D78D4AB1D79A6B6C304DB054_AdjustorThunk','_Int16_ToString_mB8D1A605787E6CBF8D1633314DAD23662261B1F1_AdjustorThunk','_UInt16_ToString_m03559E4ED181D087816EBBFAB71BCD74369EDB4F_AdjustorThunk','_Int64_ToString_m23550A17C2F7CBE34140C902C8E67A8A46FC47DD_AdjustorThunk','_Single_ToString_mC457A7A0DAE1E2E73182C314E22D6C23B01708CA_AdjustorThunk','_float2_ToString_mD74D65464FCFD636D20E1CF9EE66FBF8FBF106C7_AdjustorThunk','_float4_ToString_mD78689CF846A1F9500B643457B44F2621469FF51_AdjustorThunk','_float3_ToString_mBB1AE2BEB31583E1D5F84C3157A4227BBDB4378E_AdjustorThunk','_float3x3_ToString_m6603D72B66AC77FA88CE954E8B2424983F87EBCC_AdjustorThunk','_uint3_ToString_m03B57D27B3ECF16EB5304F14BED619D9E25A48AB_AdjustorThunk','_float4x4_ToString_mE9625D0939639D1BDF58292F4D3A679677A753F5_AdjustorThunk','_uint4_ToString_mC2E1F3FC7E97C5FC44259E3D3D2F3AB226E85528_AdjustorThunk','_uint2_ToString_m8B303780379D9A634CEE11E0C262F6A7C552C862_AdjustorThunk','_quaternion_ToString_m61124B348E7E089461C6DEED0E01D1F8D8347408_AdjustorThunk','_BasicComparer_1_Equals_m319E6DE2EC747380E76A9036563B09B2DB98EA1E','_BasicComparer_1_Equals_m00320509654A583C888BA48394316857329003D2','_BasicComparer_1_Equals_m3EBBE5641D00CF7FFE5F63D77E7E784365397B45','_BasicComparer_1_Equals_m732E403C79963B67E31D14479642AF9526D9ACAC','_BasicComparer_1_Equals_m71497C6A290A01D293491D729826E311278AE033','_BasicComparer_1_Equals_mC436B55126FD22607C93BCC571FBD262C6613C20','_BasicComparer_1_Equals_m9678C0B9B8C2A2F9B7A6E2F2AB4F95912D3D7B1E','___stdio_write','___stdio_seek','___stdout_write','_sn_write','__ZNK10__cxxabiv117__class_type_info9can_catchEPKNS_16__shim_type_infoERPv','_StructuralChange_AddComponentEntityExecute_mBD6CF6E0BD569C38B5D553AF6E1732C1A821C0CC','_StructuralChange_RemoveComponentEntityExecute_mCCDA16C549F039B003EA0378D31386228F3B0A8D','___stdio_read',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_iiiii = [0,'_AddComponentEntityDelegate_Invoke_mE45126207FEE7AC9FD3CAFF564B88E5090FF969F','_RemoveComponentEntityDelegate_Invoke_m78734E30747ECD8B12BA08B73EB32EC2FEB9719B','__ZN2bx10FileWriter4openERKNS_8FilePathEbPNS_5ErrorE','__ZN2bx10FileWriter5writeEPKviPNS_5ErrorE','__ZThn8_N2bx10FileWriter5writeEPKviPNS_5ErrorE','__ZN2bx12MemoryWriter5writeEPKviPNS_5ErrorE','__ZN2bx11SizerWriter5writeEPKviPNS_5ErrorE','__ZN2bx12MemoryReader4readEPviPNS_5ErrorE','__ZN4bgfx2gl10LineReader4readEPviPN2bx5ErrorE','__ZN2bx14FileWriterImpl4openERKNS_8FilePathEbPNS_5ErrorE','__ZN2bx14FileWriterImpl5writeEPKviPNS_5ErrorE','__ZThn8_N2bx14FileWriterImpl5writeEPKviPNS_5ErrorE','_GC_gcj_fake_mark_proc','_emscripten_glMapBufferRange',0];
var debug_table_iiiiiii = [0,'__ZN2bx16DefaultAllocator7reallocEPvmmPKcj','__ZN4bgfx13AllocatorStub7reallocEPvmmPKcj','__ZN4bgfx12AllocatorC997reallocEPvmmPKcj'];
var debug_table_iiiiiiiii = [0,'_Image2DIOHTMLLoader_CheckLoading_mD838C25F912B3BCCA8EF26439356AAA6B7C6E0C2'];
var debug_table_iiiiiiiiiiiii = [0];
var debug_table_iiiiiiiiiiiiii = [0];
var debug_table_iiiiji = [0,'__ZN4bgfx2gl17RendererContextGL13createTextureENS_13TextureHandleEPKNS_6MemoryEyh','__ZN4bgfx4noop19RendererContextNOOP13createTextureENS_13TextureHandleEPKNS_6MemoryEyh',0];
var debug_table_iiij = [0,'_emscripten_glClientWaitSync'];
var debug_table_iij = [0,'_UInt64_Equals_m69503C64A31D810966A48A15B5590445CA656532_AdjustorThunk','_UInt64_CompareTo_m9546DD4867E661D09BB85FDED17273831C4B96E2_AdjustorThunk','_Int64_Equals_mA5B142A6012F990FB0B5AA144AAEB970C26D874D_AdjustorThunk','_Int64_CompareTo_m7AF08BD96E4DE2683FF9ED8DF8357CA69DEB3425_AdjustorThunk','__ZN4bgfx12CallbackStub13cacheReadSizeEy','__ZN4bgfx11CallbackC9913cacheReadSizeEy','__ZL15cache_read_sizeP25bgfx_callback_interface_sy'];
var debug_table_iijii = [0,'__ZN4bgfx12CallbackStub9cacheReadEyPvj','__ZN4bgfx11CallbackC999cacheReadEyPvj','__ZL10cache_readP25bgfx_callback_interface_syPvj'];
var debug_table_ji = [0,'_Enumerator_get_Current_mCE502FFE9501F527E11C269864EC5C815C0333A9_AdjustorThunk'];
var debug_table_jiji = [0,'__ZN2bx10FileWriter4seekExNS_6Whence4EnumE','__ZThn12_N2bx10FileWriter4seekExNS_6Whence4EnumE','__ZN2bx12MemoryWriter4seekExNS_6Whence4EnumE','__ZThn4_N2bx12MemoryWriter4seekExNS_6Whence4EnumE','__ZN2bx11SizerWriter4seekExNS_6Whence4EnumE','__ZThn4_N2bx11SizerWriter4seekExNS_6Whence4EnumE','__ZN2bx12MemoryReader4seekExNS_6Whence4EnumE','__ZThn4_N2bx12MemoryReader4seekExNS_6Whence4EnumE','__ZN2bx14FileWriterImpl4seekExNS_6Whence4EnumE','__ZThn12_N2bx14FileWriterImpl4seekExNS_6Whence4EnumE',0,0,0,0,0];
var debug_table_v = [0,'__ZN4bgfx4noop15rendererDestroyEv','__ZN4bgfx4d3d915rendererDestroyEv','__ZN4bgfx5d3d1115rendererDestroyEv','__ZN4bgfx5d3d1215rendererDestroyEv','__ZN4bgfx3gnm15rendererDestroyEv','__ZN4bgfx3nvn15rendererDestroyEv','__ZN4bgfx2gl15rendererDestroyEv','__ZN4bgfx2vk15rendererDestroyEv','__ZL25default_terminate_handlerv','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass0_0_U3CMainU3Eb__0_m38308E5629152C6F37DDB1F8B7C2F30141860823','_Recieve_Callback_v_mC11653CF80E7F81F2EE85D3C68C972343D8E839B','_ReversePInvokeWrapper_Recieve_Callback_v_mC11653CF80E7F81F2EE85D3C68C972343D8E839B','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_1_U3COnUpdateU3Eb__5_mD816B7A6CBDAA3AD030BD9A17D5E21E0B68BCF80','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__6_m7B17AAAAC1364083833ADDA76C39FE04B8002DC2','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_mF863D8FFFDD5DAB07A3D02D7A935F4996EE792BF','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__1_m6AFBBA09FF87995493C532C34E7D4762F940BB67','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__2_m8E1BEE4AEF9F95AD709F3B17EA1EAFF5ABD16BC6','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__3_m25CD0853433F66C43273EE996AB2C630A2B98162','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__4_m29F2810FCFCD7F5FF7BC8EFDF56EADBCE54B9AC9','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__1_0_m9478441D6C1037A723A1A0EB6001CE4B38025BE5','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__1_1_mAD7781674849ED6B84EAE1D3AF30F6E25E3B6572','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__2_m18EEE8252E3429D6774CB1E88DEEA4D39993DC09','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__3_mE150762AB6558CEF7143CD9C3C279572E014BFEB','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__4_mB12BD304A1A5DE24317695F1F5B56AE9BD55A083','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__5_m6D700A723DC5E3A6DA74ADE48F87E9092CFF6B7C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__6_mC4892AD24A0B24A87F7054140C9A6972E8AEB999','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__7_mE4CC8E3543E8B7D4EE113C7CCD66C14F1AAD649C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass10_0_U3CBuildDefaultRenderGraphU3Eb__0_m86CA409F74E32D2F656DAED39FB3BB32AFF23609','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass10_0_U3CBuildDefaultRenderGraphU3Eb__1_m2FE5BF59BEE79C40C56027ECD724D7AC28540A65','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass15_0_U3CBuildAllLightNodesU3Eb__0_m8A3BAA16A25B86E9BC34A188739978492C1B6BE9','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass42_0_U3CReloadAllImagesU3Eb__0_m45601991ABABEC5270E131FBF41915DAE94C090C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__0_mEE9A2757A52E504FC049B383CE3DEAEDBD22265A','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__1_m3579E2DCA5A062EABAAE7C648B2B37722BC7F90F','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__2_mCF6598A303BFB98D0A270B85EED5FD80265EF5FB','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__3_mF085F6A929C484CFBA3B7CF31F866BE92A4EB38C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__0_mCCBB38D05DF7F2AFC4F149AAC020F7257923AC3E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__1_m9A4B7778AEA8422F34F5AE3EB64EFEBA4CC7F11E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__2_m018B4DAD124655974B44A00B446BF734FA79E719','_ReversePInvokeWrapper_U3CU3Ec_U3CUpdateExternalTexturesU3Eb__71_0_mC2805D91566527A40C7DB0B2D92BF4D32045CE6B','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass75_0_U3CUploadTexturesU3Eb__0_mFA2838749F289552F5D03E0F4E3B947B2F8E1A8E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass75_0_U3CUploadTexturesU3Eb__1_m13967E8BD0B565CB9F607394C54081777587BCAB','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass68_0_U3CUploadMeshesU3Eb__0_m0F52A5106291A94D8FB807158E4543C684517BE1','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass68_0_U3CUploadMeshesU3Eb__1_m860ECFE3010DA77F726311C8D44A01C1DE676A7D','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass76_0_U3CUpdateRTTU3Eb__0_m0D2833BF6CAD584DD364E8D1890F821711C87F5D','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass76_0_U3CUpdateRTTU3Eb__1_m150510C22F1A7B4EBE5865E72B0E9CFE5B901A40','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m776C73440E442A1E63B17752A6302A00D7E1DA0E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m7997E3CC6E80BB29EC3652D8AC4E39FD0CA790B4','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_mE7C48923AE16B18B62C2B1F2C840715ED97CBDB4','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__2_m39AF8F63A133967A62A68A72EDA82C4CC5BF1FA6','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__3_m0B5A98632248345184B9E76C37581817D7361713','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__4_m370B955F696FA009D98E6311F92C341B3481DBEC','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__5_m0DAA23B702DAD721397FE6179176BC3239733AA0','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__6_mA02CF64BB5029D16FDE19B9A996C415F2253C3E5','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__7_m7C23D96A6A2A0B46A601CB1C3E649BEFACDDFAFC','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__8_mB60AC2E6F178F794F0D7ADAA22FA7A5BC3C14D59','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__9_m0A90FA1A93A9AF07CBA61739413ECFC685D6C80E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mF357A248E8A2A39BF4832337A4D7AF2922F3117D','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__0_m40BC334338A4D65E1CB7147BDA008FFD8EC63C09','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__1_mFB656D4D666B75268C34A480A954D0356FBBCA5C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__2_m2B1AE05419F90A5E1FFB30DE5E956B88BBA99AFD','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__3_m667AD03E903DDBF143756C3EE09D1B2791684E79','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__4_m179472E0CF9A535F6A558BB2570C4B0155535F5C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__5_mF71ADC34BD86C92E66C12B61E9240BA9EB910687','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__3_6_mC1E0FCB1185243DE6BBC27D82D27B888661D2D7E','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_mBB945BF042B0B8142B48C98784E96B6CECDDF05A','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__1_m07BCF222F9E4856B4B5760A718B36F6CC4360C74','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__2_m20CEF4A43E3C8A76A394F843BECB40A5518DBC69','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__3_mF7A5234B57925D66BC1912AC5A0A1A1F28F298C3','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__4_mA2EA38AB4C7F86D805C722F57681CE2756094290','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__5_mE11458B12BBAABA0C51C014D5D35E6245FD7812C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__6_mD1ED596DEA3F60ADA9FCE9CA35333A0310FA9ED5','_ReversePInvokeWrapper_U3CU3Ec_U3CSortSystemUpdateListU3Eb__17_0_mEA566F8387BEC9AFEF5B817B9E6940C5C00FBFA3','_ReversePInvokeWrapper_StructuralChange_AddComponentEntitiesBatchExecute_mA9992EAFAB17A435D35C09B990AE5FAE52676A39','_ReversePInvokeWrapper_StructuralChange_AddComponentEntityExecute_mBD6CF6E0BD569C38B5D553AF6E1732C1A821C0CC','_ReversePInvokeWrapper_StructuralChange_AddComponentChunksExecute_m93FADB4248E9D744F87C5BA0A92F6D85F9C87720','_ReversePInvokeWrapper_StructuralChange_RemoveComponentEntityExecute_mCCDA16C549F039B003EA0378D31386228F3B0A8D','_ReversePInvokeWrapper_StructuralChange_RemoveComponentEntitiesBatchExecute_m6632C5213792F71C74F594B1A5FE346C95533033','_ReversePInvokeWrapper_StructuralChange_RemoveComponentChunksExecute_m884C1F67D3E5366A235EFFF73BECAD43451251AE','_ReversePInvokeWrapper_StructuralChange_AddSharedComponentChunksExecute_mDE42CA5BEB4AA2BD8D338F87AAE78260366C4C69','_ReversePInvokeWrapper_StructuralChange_MoveEntityArchetypeExecute_m1FEF3D40A2CDF4B15AAF65BA953B04EADA5F5628','_ReversePInvokeWrapper_StructuralChange_SetChunkComponentExecute_m2C93664388AEC82B9530D7B83D4A5D30BA04AB90','_ReversePInvokeWrapper_StructuralChange_CreateEntityExecute_m004B3E705017E2710FF182143178D852D16D08AB','_ReversePInvokeWrapper_StructuralChange_InstantiateEntitiesExecute_mCC1E269F8C1720814E7F240E61D755E9E7B4AE5F','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3CInitializeSystemsU3Eb__0_m9719A5FE728EDE1FBF0C72105AC8544447F5CBED','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass3_0_U3CInitializeSystemsU3Eb__1_mF7CB925DD32BC2BD91BE2D76B4C5CB886FB40C07','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob0_PerformLambda_m87BE33CFD398760E10F74AFEFE10EF352F280A46','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob1_PerformLambda_mBE1855D34FA165EEBA9634C3F05A62C93A52382C','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob2_PerformLambda_m847B8710686A7AEBC61CECB1A7FC11F3475F04C2','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__6_0_mB99D688B53582FDEC2C36802EC454104055C4420','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass6_0_U3COnUpdateU3Eb__1_m7B972BFCCB4900CE5052B039E0F4066C28605FF2','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass6_0_U3COnUpdateU3Eb__2_mEE344F96E4FCB16F0076961F35B1AE868AD7403D','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m91062E044ED0E6966C9DE2EF173BA0904BDEF5DE','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_mB408CC63D9C37D30E5A53EA6677A38E5CC853450','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__2_2_m2C840F9F1F90A592E73CC3D3A4B8E860D7158E17','_ReversePInvokeWrapper_UpdateCameraZFarSystem_U3COnUpdateU3Eb__1_0_m8E695A280836141D3F9F78C4A76AE7F5AFAF0BAE','_ReversePInvokeWrapper_UpdateLightMatricesSystem_U3COnUpdateU3Eb__0_0_m2E333E0AF243F78EBB124B1581B092DEDFD0C7B9','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__0_1_m0AB6657E2D66EC532E8166E79D9999FCB334EEA4','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__0_2_mB51247A4AE3D9CE066DCF197F987F5A7F44749DA','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__0_3_mAF3184BC24DFB7D0AB08ED9B2043E0E9E97ED6C2','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__0_m68DA25CBF3A19624916F5795DDF9FEA75A4D7D7F','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__1_m59B22C492C60292E735962F08871546F6C33EACC','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__2_m5342CF951FEFD87353938E25B05FDBD21B4164D8','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__3_mF2D2A80DD6A9FB20334D6AD06AFC04946F2E3A65','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__4_m95DCE9F3EB553ED48A7B657010C9860A5EDA8F25','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__5_mD80F74215A91BC213E166CD0C4A655817DCC6E11','_ReversePInvokeWrapper_U3CU3Ec_U3COnUpdateU3Eb__1_6_mFE1040400AB011EED5465A76205F242171FF2FFF','_ReversePInvokeWrapper_U3CU3Ec__DisplayClass7_0_U3COnUpdateU3Eb__0_m69465EA8081E657462A5E571D4B1026C1193F346','__ZN4bgfx2glL17stubPopDebugGroupEv','_emscripten_glFinish','_emscripten_glFlush','_emscripten_glReleaseShaderCompiler','_emscripten_glEndTransformFeedback','_emscripten_glPauseTransformFeedback','_emscripten_glResumeTransformFeedback','__ZN10__cxxabiv112_GLOBAL__N_110construct_Ev',0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_vf = [0,'_emscripten_glClearDepthf$legalf32','_emscripten_glLineWidth$legalf32',0];
var debug_table_vff = [0,'_emscripten_glDepthRangef$legalf32','_emscripten_glPolygonOffset$legalf32',0];
var debug_table_vffff = [0,'_emscripten_glBlendColor$legalf32','_emscripten_glClearColor$legalf32',0];
var debug_table_vfi = [0,'_emscripten_glSampleCoverage$legalf32'];
var debug_table_vi = [0,'_DisposeSentinel_Finalize_m2FFFF2C92D9D57F0A9D6952C96D2E2233D44DBEE','_EntityQuery_Dispose_m6BD035C2AFE55B94EB5B8CB5257452AB04D79229','_NativeArray_1_Dispose_mFA65F41DF1E79C480503042F2290B7A924F1CCD8_AdjustorThunk','_TinyEnvironment_OnCreateForCompiler_mB0880714FC21EF8066C0BBF2F51A5CF0382AE3C4','_TinyEnvironment_OnCreate_mE5BF46A04BD56CD3D04C6D4418F899B976619C6A','_ComponentSystemBase_OnStartRunning_m444D54487CDBE4E69F22B7CE24D26B2ACFEAAD91','_ComponentSystemBase_OnStopRunning_mADC428F879E52AB8D0103F647D8057728BE1A6C8','_ComponentSystemBase_OnStopRunningInternal_m6C0C5C4EACE1CEBDF4A82B73C527BC11CCB754C8','_TinyEnvironment_OnDestroy_m405939C725A5165AEF263BDA09427E050944C0ED','_ComponentSystem_Update_m7824E4A05510D41B529A13FAC6209AF3C82120CC','_ComponentSystem_OnBeforeDestroyInternal_m61F5D829C76EB3A9967E8EBBAC730D8BA19BC879','_TinyEnvironment_OnUpdate_mA3C8B369F9DE1DEE88E7337E3A26837C7AECD6C7','_ComponentSystem_OnCreateForCompiler_m5A314CC02D8829C5426BA9D4A671EB3661231C15','_ComponentSystemBase_OnCreate_m7813FB95A084E66430CCB665649B1AD3B7CF58BA','_ComponentSystemBase_OnDestroy_m1038AF8F050BC12F1996047E1198DD4AB78B38DE','_ComponentSystemBase_OnCreateForCompiler_mFE134D50E4009CC3310CE81556FE55A851D645BF','_ComponentSystemBase_OnBeforeDestroyInternal_m814B47C16DB353F993563CAE40C7AB9A67D48FC5','_NativeArray_1_Dispose_m64E35E2538530D994E54789648F10A8E58DD92AF_AdjustorThunk','_World_Dispose_m82C5896980F6CFE6827FB93E354BA327FBAAA7A3','_MemoryBinaryReader_Dispose_mF0518383D1B2BCE8B84DB15D7D63375572DBBA0D','_AsyncOp_Dispose_mDAD7CF618414C0A5D9D0CF2C50AF3E8FFD46CF8F_AdjustorThunk','_v_Invoke_mEF678BC48F4174BCE6196252D007E2476A200376','_Action_Invoke_m1E9AA1E12709BC1750FADBA22539E1AA10218E25','_Connection_Close_mA40BF3503A8BEF8E857174E1BF2C48A363768BE4_AdjustorThunk','_BlobAssetOwner_Retain_m282089A386F41519EED1E8BC9267CBBECC33AED8_AdjustorThunk','_BlobAssetOwner_Release_m99EE8FEE6D574AEBD689E9EA01B9F8004712F125_AdjustorThunk','_BeginInitializationEntityCommandBufferSystem_OnCreateForCompiler_m1C73BACF4C7ED8788BC27CE3253D07FD2AED51B3','_EntityCommandBufferSystem_OnCreate_m604AC3ABCCA837D8B9D5C9C8E79DCE187B0D0212','_EntityCommandBufferSystem_OnDestroy_m96E0C32249539B25D3F811F134E1B2E26A7705E7','_EntityCommandBufferSystem_OnUpdate_m89BD414F2D03DA14159D3776A557A8DFDA5DB710','_EntityCommandBufferSystem_OnCreateForCompiler_m1B780F3D2501091529A119366037D74468FF1D34','_EndInitializationEntityCommandBufferSystem_OnCreateForCompiler_m3AF702E887611DFF3A8DB49323A5A122A1452D61','_InitializationSystemGroup_OnCreateForCompiler_mD0F59D1BED38E26AD193B17BFCD26E902141DC08','_ComponentSystemGroup_OnStopRunning_m17EB389CEF9DE3D0D33572C37BF48F6A903A9927','_ComponentSystemGroup_OnStopRunningInternal_mEC5125FE8D9E67BEA042079DB37CFC1BD4BB2973','_ComponentSystemGroup_OnUpdate_mCD92A70C8D7A7DAA659AAFACB3D502643552ABBB','_InitializationSystemGroup_SortSystemUpdateList_m93DC1AAF54898E8495BB9313EEBD7900093717C4','_ComponentSystemGroup_OnCreateForCompiler_mD8C9A497095111A28D96B00656A41E08DAB86D19','_ComponentSystemGroup_SortSystemUpdateList_m0C5C17341A8BFE4BDB5BFBF6C6DA0607326AA3DA','_BeginSimulationEntityCommandBufferSystem_OnCreateForCompiler_mEEF11C9E9D358FD21B962006B643890CE5C7A0A6','_EndSimulationEntityCommandBufferSystem_OnCreateForCompiler_m7DEE35179EEF666CA899FB477830835305597631','_LateSimulationSystemGroup_OnCreateForCompiler_m000C24DEB9786A53CEAC9ADE80EA4A7851317F26','_SimulationSystemGroup_OnCreateForCompiler_m7749044310B1019E95DFE5B429CFD680A282EB2D','_SimulationSystemGroup_SortSystemUpdateList_m4E9A0BA78978F513B9097AF6A112B4C65EFBEBD1','_BeginPresentationEntityCommandBufferSystem_OnCreateForCompiler_m331C1B6A9E90D78D696948368D3E81B5F6EE3C78','_PresentationSystemGroup_OnCreateForCompiler_m4852FB43EE3BD1E707316D5540053D2907633EC4','_PresentationSystemGroup_SortSystemUpdateList_m103F36D8CD7105291987F9C8549378A4115FA793','_RetainBlobAssetSystem_OnCreateForCompiler_m00DCCB8EDE56F0EBCD65E506D33C5A09931F8FA2','_JobComponentSystem_Update_mE131BF81735D0D14D56E3AC1930C0FC1B34C2515','_JobComponentSystem_OnBeforeDestroyInternal_m5E01F27CF427A54EC925A0C08BA687A4CE1C62F7','_JobComponentSystem_OnCreateForCompiler_mC3E36DD6BE3207B8B23A153B2E2C824827A7B844','_EntityPatcherBlobAssetSystem_OnCreateForCompiler_mFC1FE67CE27BA68189A300B073A6E0FC591DBAAC','_EntityPatcherBlobAssetSystem_OnCreate_m94D83DDA7311F0E5DCF7DEE277A9E1F393F47946','_EntityPatcherBlobAssetSystem_OnDestroy_m82CD8B9B0482F25BBA5BC3658FF08738141FA9B6','_EntityPatcherBlobAssetSystem_OnUpdate_m62EA61D5EF6F2DEA0D2D8865AF43BBA4F1E9D4B0','_TransformSystemGroup_OnCreateForCompiler_m29557429F0A6FFA9BFB10809187B596106114BC1','_EndFrameParentSystem_OnCreateForCompiler_mE46381FC1A2D7C06265F325181BD0B46517CAA37','_ParentSystem_OnCreate_m3BE707375EF12FAC339C65B204AC10584B896E9D','_ParentSystem_OnCreateForCompiler_m6B27CDE536BA9254D98C9A84898AF9FBE4389664','_EndFrameCompositeScaleSystem_OnCreateForCompiler_m92B1DE739E3867049CD37581BC919F92BD7A0C9B','_CompositeScaleSystem_OnCreate_m7E3D9629E258282EB9913E894901DCC8D4C74315','_CompositeScaleSystem_OnCreateForCompiler_mC357402DC518B4884299F7F52A1794BB3B961DE2','_EndFrameRotationEulerSystem_OnCreateForCompiler_mA2280AAE76320C754DD85ABE5CBC7C4391214A3F','_RotationEulerSystem_OnCreate_mC28EEA5E03F35A7FF59825DC14FE055BB91FF62D','_RotationEulerSystem_OnCreateForCompiler_mFF925B204F0F02ED022735319797A60AE0769BFB','_EndFramePostRotationEulerSystem_OnCreateForCompiler_mB777A725C428667D3DC5599BF9BAEB4B3A08F1EE','_PostRotationEulerSystem_OnCreate_m939944EDAB14F3CEFD4024218836E256C12ED515','_PostRotationEulerSystem_OnCreateForCompiler_mEC160730249F3A5B722721A846E864F8E5C67D16','_EndFrameCompositeRotationSystem_OnCreateForCompiler_m9CA0EEF6E09767CBA72BDB428E2D470E106BE83D','_CompositeRotationSystem_OnCreate_m95348C2D99A201D56EF4D4C4DCD714E865304968','_CompositeRotationSystem_OnCreateForCompiler_m8E692D049992317CCD9AD6AD96A2BDF035D15A46','_EndFrameTRSToLocalToWorldSystem_OnCreateForCompiler_m58D71199AF5F173E6824BCDFE5DDC5F24A3F2084','_TRSToLocalToWorldSystem_OnCreate_m9FD8088A1B4AC080E22127C0FD086986556990EB','_TRSToLocalToWorldSystem_OnCreateForCompiler_m4BC26FEFB874F2FE88CD739C82065C5E0C126A21','_EndFrameParentScaleInverseSystem_OnCreateForCompiler_m1C019F0322FFB68A1611BA0DD4CC9BD75C3C594F','_ParentScaleInverseSystem_OnCreate_m930F7E0240FE28D5B857CAF4B28EFD3EB0545FEB','_ParentScaleInverseSystem_OnCreateForCompiler_mAE43D6CBA1016FF3B772A990DBAC2568E9DC72F2','_EndFrameTRSToLocalToParentSystem_OnCreateForCompiler_m8FCD2F10552A10F7942F8E8B38990C629B23AA62','_TRSToLocalToParentSystem_OnCreate_mC0848A3F7503A473F38A5BA9DE0567B7F44C161A','_TRSToLocalToParentSystem_OnCreateForCompiler_m13DC2FDC530F6FBB92509EA5AD431C0FFECCB171','_EndFrameLocalToParentSystem_OnCreateForCompiler_m8593D34F8116D93AE6301465498BABA43FFA1CF9','_LocalToParentSystem_OnCreate_mFD39D74434578C6167F9DAB043245ED9EF49775B','_LocalToParentSystem_OnCreateForCompiler_m7D70EDB955F64BDD28FDA2FF09E52B0AC9372D3E','_EndFrameWorldToLocalSystem_OnCreateForCompiler_m1FDC5E7441BC5BF20BD253A168AD90CA07CF1953','_WorldToLocalSystem_OnCreate_m794B81502374106360FBB863B19E429BD207898F','_WorldToLocalSystem_OnCreateForCompiler_m1948C95C7B6A6F5FE6204F4B5B4AADDBD974F51A','_HTMLWindowSystem_OnCreateForCompiler_m73995D0248B4A7CE17341CA8F13BEA3566797BAE','_HTMLWindowSystem_OnStartRunning_mD8547572760DBCAFD77460CA03E604A352CFE2C1','_HTMLWindowSystem_OnDestroy_mFA1493ED1C96C079D3F884223878CCB117A7C9DB','_HTMLWindowSystem_OnUpdate_m31AFF29FE45D0AB220A04E967B8D08FCBEC01522','_WindowSystem_OnCreateForCompiler_m1619FBDCA276B075946BB73FAFD88A3685AF005E','_UpdateWorldBoundsSystem_OnCreateForCompiler_m49827098F480BC59CB99AEB37130E7C8B5A797B6','_UpdateWorldBoundsSystem_OnUpdate_m54A435015F57E77BF25A9F4E1E5C92D1F92F7AC8','_UpdateCameraZFarSystem_OnCreateForCompiler_m8B6A17210DE9E24DFE5A389B2C5007D910874AEF','_UpdateCameraZFarSystem_OnUpdate_m02A85DB9DB423BE20E120E072321FA01E1910DA5','_UpdateCameraMatricesSystem_OnCreateForCompiler_m9E1E1051CC9D2E8E6A00F08AD5C730CE946B6896','_UpdateCameraMatricesSystem_OnUpdate_m0DFAB3819D0EB7291DF84F4F681B578507DBBCA5','_UpdateAutoMovingLightSystem_OnCreateForCompiler_m7E139E2CD50F8BD01B08201F82084E618404507E','_UpdateAutoMovingLightSystem_OnUpdate_mA11128052BD5D44579ED73088A2AB72EA0906ED4','_UpdateLightMatricesSystem_OnCreateForCompiler_m4B55E5B0325A04874B92B33F97AF171DE3CB190C','_UpdateLightMatricesSystem_OnUpdate_m23CEB57165CE6E714C67F9424A554EB3B253AB09','_EntityReferenceRemapSystem_OnCreateForCompiler_mAC437DEAD10D594FE596386DE90128E5CFE2EDFC','_EntityReferenceRemapSystem_OnCreate_m5F0440027313A18C0F89B9CE4EF894B817C55E08','_EntityReferenceRemapSystem_OnUpdate_m7FFD7B2B38D7FD68BA290391E457FC20036D2215','_ClearRemappedEntityReferenceSystem_OnCreateForCompiler_mDD3629B66C35CB811374E609C7A3CCBC85592551','_ClearRemappedEntityReferenceSystem_OnCreate_m5199BBD0F9D4E679F54543B5CCE66087F001D8D9','_ClearRemappedEntityReferenceSystem_OnUpdate_mAE9CB30C9018B26CE5A53493F988D4F4BF579AF2','_RemoveRemapInformationSystem_OnCreateForCompiler_mEC548C20BE96DFBA480C1E6F5A46A3F5B1D3B720','_RemoveRemapInformationSystem_OnCreate_mBAC71C486C2DBE02EA95D7456CE196CAB10E8241','_RemoveRemapInformationSystem_OnUpdate_mBB109BD2472C77492FFEC47F26E82EC6162A158B','_SceneStreamingSystem_OnCreateForCompiler_mBCB6054440E873A7D783A92023A2C107DF59E63C','_SceneStreamingSystem_OnCreate_m95AC3FF01EE9A45AE00A5B3F9904FF1BD3B68B61','_SceneStreamingSystem_OnDestroy_mBBB58365545A694578F323FE26DA7D75F3FB6306','_SceneStreamingSystem_OnUpdate_mCF55A79992062267AE85863BC662FE59298D6E65','_Image2DIOHTMLSystem_OnCreateForCompiler_m068DA05E97351A1EAEC6C7314D6AE6711DF1EE11','_Image2DIOHTMLSystem_OnCreate_mC1037C08D62E0FE8EFB6BCA5D4C96E976FCA591C','_Image2DIOHTMLSystem_OnUpdate_m6FC2205C1B31312861C8A0655D3774343BFDFC60','_GenericAssetLoader_4_OnCreateForCompiler_m171FCEAD177FC268772D0E06D7207D84F7DCA61D','_GenericAssetLoader_4_OnUpdate_m23D3C8E76EAF999C84A7FDAE96F23CFB4D7207A9','_UpdateMaterialsSystem_OnCreateForCompiler_m7891C3A9DE429FA7B2176C003B7B774F94F0D9BB','_UpdateMaterialsSystem_OnUpdate_m5CA74B197052D9718308930BC99D7ADE51A5206F','_RendererBGFXSystem_OnCreateForCompiler_m0DBB6313CCEA18E81D02F73AFB18F7F16E8A8391','_RendererBGFXSystem_OnCreate_mBE8D17CCD840748674D35D4D94B0BBDD3C5CCCAB','_RendererBGFXSystem_OnStartRunning_m66D0AADA13510BF209FAE3E5ACEE7CE856E05493','_RendererBGFXSystem_OnDestroy_mBC00C011EFBFA21384B321024F03681B90E7B3EE','_RendererBGFXSystem_OnUpdate_mAA1D59A2CB3FDB5936F22F4DDAE3BE8B56E143F1','_RendererBGFXSystem_Init_m67444CFF169CA91D49A2E80C4CA686F53AA53FC7','_RendererBGFXSystem_Shutdown_m02448BFF3638E294AE74D977225450125314A8B4','_RendererBGFXSystem_ReloadAllImages_m85629DDE15A222FCDDD25C221DCE6056B5EFBA0D','_RenderingGPUSystem_OnCreateForCompiler_mE1E3AB5E17735FA76E0A8E2DF1E63A2E9E6B0BE8','_SubmitFrameSystem_OnCreateForCompiler_mD195084225C54E763C47123354F17D4544002E5E','_SubmitFrameSystem_OnUpdate_m57131C67A0F7BBB8F762116BF9986C2BDBCF14F5','_PreparePassesSystem_OnCreateForCompiler_m07CFD9E2561A1BA8E185B63823BDD65F45751217','_PreparePassesSystem_OnUpdate_m57165E3F06F223EC545006E1D17865AB5708D554','_RenderGraphBuilder_OnCreateForCompiler_m48CBEC44C5439B18ADAA68E22628347641F27A49','_RenderGraphBuilder_OnUpdate_m2807BE5F7031EDD1A6144FA952A2574F9938806A','_AssignRenderGroups_OnCreateForCompiler_mA9EC16D1680F11EA741C0473FA66AC37F9648467','_AssignRenderGroups_OnUpdate_mA21DC97921D8CA982180953FBBC6C22716EA3A40','_SubmitSystemGroup_OnCreateForCompiler_m7147D6E78B66A05CD951BDD2351E0D0420CE22C2','_SubmitBlitters_OnCreateForCompiler_mC373AEF05182714AD229DEA10F96F27F031ADDC2','_SubmitBlitters_OnUpdate_m9D7061543CC7F047B7F45740A6FA7A119C1643C7','_SubmitSimpleMesh_OnCreateForCompiler_mA74821BA6D023396209D002E1BB5828B189C7A2F','_SubmitSimpleMesh_OnUpdate_m9D222064A6FDCBBACD782D4F4B02C97C89D288AA','_SubmitSimpleLitMeshChunked_OnCreateForCompiler_m6B42180BEECC05AF51C24FC6B98220F9109B174B','_SubmitSimpleLitMeshChunked_OnCreate_m506A1BD9D2CC4FBB1640C9DE7B1E418D8C176A02','_SubmitSimpleLitMeshChunked_OnDestroy_m486F9798C5430CB5335717832467FE873E26A6BC','_UpdateBGFXLightSetups_OnCreateForCompiler_m98394EA670ABE8AFC871069624B14BE00A0B8B4C','_UpdateBGFXLightSetups_OnUpdate_mFB7877A72DAA2564CB11AE6709DFB96B2AC8E393','_SubmitGizmos_OnCreateForCompiler_mD2DE9CF225473CB0A52638661143A36448BB2A83','_SubmitGizmos_OnUpdate_m31C188A24E23288E9249125F9E33335129E24DDA','_Invoke_OnCreateForCompiler_m0352E706BBE112B4C56863ED88E372C5C1391819','_Invoke_OnStartRunning_m6AE5AF1B3B314C707A8250E17F90EBAEB44DFC6A','_Invoke_OnUpdate_m652338791B8C8F7E3254797267199D671AA26581','_Recieve_OnCreateForCompiler_m0348C4D316BDE05CE67B07463F217BB129755418','_Recieve_OnStartRunning_m912F0247E061B55D721EB38FA61803ABF986F790','_Recieve_OnUpdate_mE5793F8D00C335D9A0627109F0C413C414869DD7','_UnityPeerJS_OnCreateForCompiler_m3FE81B49B5D72EBF7FD00DDEEB9AED9AF4BE502C','_UnityPeerJS_OnStartRunning_m7847E2345D045EBA213898F0E638583F305EA12A','_UnityPeerJS_OnUpdate_m11D0C0E17D133C067E12CA80010D66A0E00E5549','_EntityQueryManager_Dispose_mF1D0A82EED06A0E24829D25D2C6CE6F5FEAF3AC0','_UnsafeArchetypePtrList_Dispose_m3A61AD2B325D6A761F0DDC190D6D00C8FF2E6866_AdjustorThunk','_NativeArray_1_Dispose_m2C63F421803097D24401C1B67CAC322D8E7F3831_AdjustorThunk','_NativeArray_1_Dispose_m9A8A96A09418C9DE6ED4618767BEC03C1580747C_AdjustorThunk','_InsideForEach_Dispose_m04D005E8B2FE6DB8BA7154ADC4B8DF759694EEBC_AdjustorThunk','_NativeList_1_Dispose_m5CC6C36BC8C118E980E1A9FA711C599E5E098438_AdjustorThunk','_NativeArray_1_Dispose_mA416CC5816E45BB4080341CD481888CF4899917F_AdjustorThunk','_EntityCommandBuffer_Dispose_m5BA38D9DF18BE55B4BD004DC6BF17DE4F303312E_AdjustorThunk','_Enumerator_Dispose_mF8E60D3D0C5890B085C086D26251E623E15A686D_AdjustorThunk','_Enumerator_Dispose_mE2292A2CE595BB532E64DB61E0087A376F8A59B0_AdjustorThunk','_Enumerator_Dispose_m11AEA0EA9CD7510857F08110C7EAF60DA4411A8D_AdjustorThunk','_Enumerator_Dispose_mD546676A7AB61FA26E8D8B1EC0FEAF6B28E6249C_AdjustorThunk','_Enumerator_Dispose_m1149CAC7CA990C397783103210BA20536B9D4577_AdjustorThunk','_Enumerator_Dispose_mB6A5BE4768C9C19AE6D039001141D8DD82E65B97_AdjustorThunk','_Enumerator_Dispose_m6F426FBE30647A697F041056380521058E469B8F_AdjustorThunk','_Enumerator_Dispose_m2C2C02CBAADD5B9DEA07E38A0B5A333B0FC534A9_AdjustorThunk','_NativeArray_1_Dispose_m9D8B8856DBDD9D5BE2C9F67AFBAEB9332449DF02_AdjustorThunk','_Enumerator_Dispose_m3ABA2D1CF3BDC8AF769795D93EEDF088CF9458B6_AdjustorThunk','_NativeArray_1_Dispose_m460A5A8DCC4C78F64C6D59748C648548F55BF4EE_AdjustorThunk','_Enumerator_Dispose_m5530E7D420383B04D093CBC2AE8018C40CD6DF83_AdjustorThunk','_Enumerator_Dispose_m739E8861730CEECE453DDFF1D88D1C33DDB77A21_AdjustorThunk','_NativeArray_1_Dispose_m728F23AB2FE13474D35BDD2EB5AF20C6715144A3_AdjustorThunk','_Enumerator_Dispose_m738BD1C9918C2C70FB994DF5821F68A06F07EF66_AdjustorThunk','_NativeArray_1_Dispose_mCEF67491284356F2B54B3E33A10EF050CF20FBCF_AdjustorThunk','_Enumerator_Dispose_m6A30012C5E596447FA5AD53638E806E328CC271B_AdjustorThunk','_NativeArray_1_Dispose_mDFDD8CF7FA42B6145E73E91EB9D8130268CA1388_AdjustorThunk','_Enumerator_Dispose_mC8A0B38357C3CE2810B9A18DFAE2786AF4F22167_AdjustorThunk','_Enumerator_Dispose_mEA347921B9678F1A4CEA7234EC4A641AC8C17115_AdjustorThunk','_NativeArray_1_Dispose_m0C3473A018E8E908D3BCDD450272D1E62326CC28_AdjustorThunk','_Enumerator_Dispose_mD288CFDE1E1DD4BBFF26DAFF41B2AA3DE05E31CE_AdjustorThunk','_NativeArray_1_Dispose_mFAE53D9FA271E2E5D8166D7DF5FEC37AB5DA185B_AdjustorThunk','_Enumerator_Dispose_m13E8903E597F650C1AF21461BD9B96D0D83BF6D5_AdjustorThunk','_Enumerator_Dispose_mF59B00628A0231BAF7986BC3FED771078165AE7A_AdjustorThunk','_Enumerator_Dispose_m9FD72A42832C3FBABEEE4A7ED6B2176E3D081DB3_AdjustorThunk','_NativeArray_1_Dispose_m648401B552DEA4D8431A595C9359793D03C302F2_AdjustorThunk','_Enumerator_Dispose_mC1DA238F5983A6A6CFA4CC604FC95E2EA3F7F0B1_AdjustorThunk','_NativeArray_1_Dispose_m34457986ABFB911A25E3DE286CEBDC56F5796B6B_AdjustorThunk','_Enumerator_Dispose_mDFB443D1455D447648437DE3D228AB254FE0E9A0_AdjustorThunk','_NativeArray_1_Dispose_mBF7533369EC7FD2BF5C194BAB9A70030053E6F33_AdjustorThunk','_Enumerator_Dispose_m509BE0D38CF632FC080EC33267A6DC6F44E41EE6_AdjustorThunk','_NativeArray_1_Dispose_m2195E339A3FB67D50750A6A756B720DCF13F31DF_AdjustorThunk','_Enumerator_Dispose_mBAA165B06CFF663358E523EE1061E2AA039E4CDA_AdjustorThunk','_NativeArray_1_Dispose_mF916C6EFF1F2BAA826A453E388B6BA7D2CA6AE1A_AdjustorThunk','_Enumerator_Dispose_mD7F7970CB75BEFD72938C9A8FA48E8CC9B0D8434_AdjustorThunk','_Enumerator_Dispose_m3EC1D5C9F73912AAE212354B9E90F811FB1D3C83_AdjustorThunk','_NativeArray_1_Dispose_mD1A12E30F0BFE17DA7F753A7AA1916BBA554FACD_AdjustorThunk','_Enumerator_Dispose_m42F9872DE1BD393864D4E47C793FBFD618CB7E86_AdjustorThunk','_NativeArray_1_Dispose_m2FF3549CB54D79D2FCACCDA90D1C1742BDD5512A_AdjustorThunk','_Enumerator_Dispose_mC8D040F320C4A6A741713B8D20C6F8E17D1F2883_AdjustorThunk','_NativeArray_1_Dispose_m5DA362D3EB78A34E7C43B45FD6A59D2CCD8F1BDC_AdjustorThunk','_Enumerator_Dispose_m1C6B687063619DF8C062DE76CD899430EDF5DFB8_AdjustorThunk','_NativeArray_1_Dispose_mE2EBCC75FEC213420AB1CC5E887923B862B86FCA_AdjustorThunk','_Enumerator_Dispose_mA7A8B9C98F173C805F745B6FE85988D5F9D3EBE6_AdjustorThunk','_NativeArray_1_Dispose_mEE9115483F79F9BB2E1D8628016029BEC42D6384_AdjustorThunk','_Enumerator_Dispose_m401387BF3F1AA4CEDA632FE907579BE467C1E5A5_AdjustorThunk','_NativeArray_1_Dispose_m7DC31A3BAC8686B1CE634FA024A6809E97460C6C_AdjustorThunk','_Enumerator_Dispose_mE8AC07BFFBB32AE63DC91E3F45FD217B06494E12_AdjustorThunk','_NativeArray_1_Dispose_m155005186EC2C7880359E448F24218611EEDF994_AdjustorThunk','_Enumerator_Dispose_m597D766BCC0A98929D312F3E6B07D52B1E6D5C8E_AdjustorThunk','_NativeArray_1_Dispose_m19F56504F81D6431EAF0A2D6C057C61C5B2D8FA5_AdjustorThunk','_Enumerator_Dispose_mD368E96CF96F0AED3EA6497C41214E74BE676C27_AdjustorThunk','_NativeArray_1_Dispose_mB7B71B49472DB799B68A272C17F5DDBDFB0FF5F2_AdjustorThunk','_Enumerator_Dispose_mE686F2ACCEEAC8FF0054A50764DB3DF672A36C2A_AdjustorThunk','_NativeArray_1_Dispose_m9BA025104FF8134CCA0EC29AC76F4AEC156B051F_AdjustorThunk','_Enumerator_Dispose_m0785FE74830ECC629401DE18C1FD1A3C4991C8AC_AdjustorThunk','_NativeArray_1_Dispose_m60A26625937C06EBED751B7A220D5664356AEB01_AdjustorThunk','_Enumerator_Dispose_mA8BD0EDABE64ACE8D8F7F376B674A70146A97D49_AdjustorThunk','_NativeArray_1_Dispose_m6FCFF215C4DF85D07FDBE94A0FEDEEFB4DA1FFAE_AdjustorThunk','_Enumerator_Dispose_m8B3F8E15D032FBDBDDACAD90571728EFF5FB27EE_AdjustorThunk','_NativeArray_1_Dispose_m3B888D120857F7092480363D5045E76BBAA82119_AdjustorThunk','_Enumerator_Dispose_m6B12D432A05664FFDCD595F9B3110322C63F5465_AdjustorThunk','_NativeArray_1_Dispose_mF4F444876183ECE167F6900B17E6C74C8B1FDC57_AdjustorThunk','_Enumerator_Dispose_mAFD1F0595A94DE3B3BBC12FD6AF61700EAD32868_AdjustorThunk','_NativeArray_1_Dispose_m866127201BDA09401D229376477EE9B0DDC3CF59_AdjustorThunk','_Enumerator_Dispose_m47B4510CD7775B85D926573028F3809DDEC2E963_AdjustorThunk','_NativeArray_1_Dispose_m5AB07740E9CE184D7B820C862FFEBB376C76A808_AdjustorThunk','_Enumerator_Dispose_mF8CD3EE275032B2F8CF5F5FC30932F1386C2FDA5_AdjustorThunk','_NativeArray_1_Dispose_m617488B5958413038D64DDE45BC26BE9B383F6AA_AdjustorThunk','_Enumerator_Dispose_m40162DF9BBE1F33D05E3080EB6225889467C21A9_AdjustorThunk','_NativeArray_1_Dispose_m3A32BB2A430D164BEAF57A7C63B771CB04ADD8EF_AdjustorThunk','_Enumerator_Dispose_mA1B1EBB6BAC843EE5E28F8CF498E19D446063E7A_AdjustorThunk','_NativeArray_1_Dispose_m200D4670537CACBAA039C69281AEA7300CC970F3_AdjustorThunk','_Enumerator_Dispose_mDBDBEE62F1E0729176F34E03EEEE52C99C4E09DF_AdjustorThunk','_NativeArray_1_Dispose_mCDFFCB12556F89B6099A792B8F20EA9AB7D7D121_AdjustorThunk','_Enumerator_Dispose_m4108F190BE325B6D61E741CB02834237726663EC_AdjustorThunk','_NativeArray_1_Dispose_m4742EE31D35E13D583C811BC8FE31586F564CB57_AdjustorThunk','_Enumerator_Dispose_m2BAE433CA6D0E98C52594D2690990DF6DAAA7974_AdjustorThunk','_NativeArray_1_Dispose_m9EEB9FB23ABF50A35DF21EE0398F41283EF3BB1F_AdjustorThunk','_Enumerator_Dispose_m7FD12C71F6A5B3447837B7EE423CEFEF75312B51_AdjustorThunk','_NativeArray_1_Dispose_m12A1414FEDC79E95AAF51D2A0B52FD8149B44D45_AdjustorThunk','_Enumerator_Dispose_m1D065193B733672E15BFC25F8F3ADB423847659A_AdjustorThunk','_NativeArray_1_Dispose_mCB487F9A23B8888EAC187699AE4014BA86E859F9_AdjustorThunk','_Enumerator_Dispose_m2CFB55CC60F04750FD071E3A698E0EFC432A583C_AdjustorThunk','_NativeArray_1_Dispose_m0F4F18526FCBFA8F0E1091B307115CBFD1056A00_AdjustorThunk','_Enumerator_Dispose_m46B7DC91761B596584CF067260697CCA776CE297_AdjustorThunk','_NativeArray_1_Dispose_m147CF5900686051163C57BF5B4C32E4317DDCA61_AdjustorThunk','_Enumerator_Dispose_mA019A10B61DB8B01F65ABEE5D8C19BAC76065FA2_AdjustorThunk','_NativeArray_1_Dispose_m9FF83CDEA2BD245DE016DBADEF48931DAB8C3556_AdjustorThunk','_Enumerator_Dispose_mF265875A8CF320439E03C4258DCA1FCA9D8BE02E_AdjustorThunk','_NativeArray_1_Dispose_mF252487DC5D1B5F9AE7F45C8FC87F5793DD79458_AdjustorThunk','_Enumerator_Dispose_m6FE351967DA9699CE390579F25682A54182C17CE_AdjustorThunk','_NativeArray_1_Dispose_m0F605C75B7FEA660FB66D55CD754977C5141BA6B_AdjustorThunk','_Enumerator_Dispose_mC58C610AB40342F8CE39C71591E8B09B1872E710_AdjustorThunk','_NativeArray_1_Dispose_m972C7291C1C46CA9BC77166C542F67A66F04DEE9_AdjustorThunk','_Enumerator_Dispose_mD3FF10B328F2915285ABF43A2FF27ADC64F5EE2F_AdjustorThunk','_NativeArray_1_Dispose_m14D8D5BDD5039F51DA6571D0353E04B04D90049A_AdjustorThunk','_Enumerator_Dispose_m65FF9731A2CE8C8ACBEB8C3FC885259A5FAA6B40_AdjustorThunk','_NativeArray_1_Dispose_m14C21DD385D6967C93F15C0E34BB8D3DDEC01C1C_AdjustorThunk','_Enumerator_Dispose_mE70C09565A29764A24F14BF3D4AD866FC17ED7EC_AdjustorThunk','_NativeArray_1_Dispose_m5FE2034D7E88A6D2265B32567EC941F6E1DA65DE_AdjustorThunk','_Enumerator_Dispose_mBE87EA8CC60D71B30B9874E3E67897F0676585A2_AdjustorThunk','_NativeArray_1_Dispose_mB63015157E7E0D9DFF7387E56CB932E822806BBD_AdjustorThunk','_Enumerator_Dispose_mB87BFE0FB58E88B68014403C3DFECD585E7EE611_AdjustorThunk','_NativeArray_1_Dispose_mD49960A88ACE4837393873B65F70224F6AFE208A_AdjustorThunk','_Enumerator_Dispose_m0AAED1B1E5D1F305485718C7F59FC8BC62D85F71_AdjustorThunk','_NativeArray_1_Dispose_m45CD6482B5FC1681952ECDEC27AB95758A670823_AdjustorThunk','_Enumerator_Dispose_mA713590D51A4333EB996ED5F91EE1BB76A416E7C_AdjustorThunk','_NativeArray_1_Dispose_mECF503F0929538C1663617B35FE8C354D22D44CA_AdjustorThunk','_Enumerator_Dispose_m0326E61E5FDA0E72B6011FC9D7B536027C418407_AdjustorThunk','_NativeArray_1_Dispose_mE8B1F064CE5ACB68370B8781A13615D2D3F43679_AdjustorThunk','_Enumerator_Dispose_m6F9FCC583F56A2CC4A46631EE60F6D8E92E9B750_AdjustorThunk','_NativeArray_1_Dispose_m85EE2233068A41582D7C79538F65C546930081FC_AdjustorThunk','_Enumerator_Dispose_m9CF48041C8EBE010403FDFDD26BBFE0859B91199_AdjustorThunk','_NativeArray_1_Dispose_m5326E9B6BD5E4B29EC5E1CF5E55B86BCDE20844D_AdjustorThunk','_Enumerator_Dispose_m741F8FD74503E31715631D7814A8479B14FE0AFE_AdjustorThunk','_NativeArray_1_Dispose_m0CB06513FD6B4DAF48E5721ED1570ABBA7DB2421_AdjustorThunk','_Enumerator_Dispose_m9F028372CA8B4759CC47B07E4BA87F475F14CF31_AdjustorThunk','_NativeArray_1_Dispose_mB36C256AB61E521609450DD76CB982E8D2ACF8A7_AdjustorThunk','_Enumerator_Dispose_m0A04F99C1ABA1300636EBAAEB16A46BAF3C2100A_AdjustorThunk','_NativeArray_1_Dispose_m87B7D251CF847B9B717915AFA9778A1502349DBB_AdjustorThunk','_Enumerator_Dispose_mD446F33C987D14C550D3B0CCC4F4DF0AD12A7DDC_AdjustorThunk','_NativeArray_1_Dispose_m2251B05AB5228E5CAEA630EC17C50F40D566FECD_AdjustorThunk','_Enumerator_Dispose_m0F6A92F720346EE9CAECC3D9B70481B4C4850413_AdjustorThunk','_NativeArray_1_Dispose_m0FDE2D82A16B6199BCDA060610B5687A43B941EB_AdjustorThunk','_Enumerator_Dispose_mC312023DDD585E0A415B5A963DB8B3CD3F295A87_AdjustorThunk','_NativeArray_1_Dispose_mB7ADEDBF0E392BA9F993C9C454FA052DB16BA996_AdjustorThunk','_Enumerator_Dispose_mEA054E90377423FF24F6D64E353D71132F202AB2_AdjustorThunk','_NativeArray_1_Dispose_m1FA524C4E5F871E6837B3EADA83007E7F4FD7DA7_AdjustorThunk','_Enumerator_Dispose_mC2DE0B4A6F9CF87F6805EE0D1BB49A3828869181_AdjustorThunk','_NativeArray_1_Dispose_m3AD62E5FE28698DA7608B3B3C5FD1BC87C0B2281_AdjustorThunk','_Enumerator_Dispose_mADE2638D51084F2A56723F16BD9E1FF7D7CBACD5_AdjustorThunk','_NativeArray_1_Dispose_m43D82B5E40294DE1249849A1ACD756B6966212DF_AdjustorThunk','_Enumerator_Dispose_m1BFCE56149A95D4D8F46A6C70EC2CEA91FB97D50_AdjustorThunk','_NativeArray_1_Dispose_m47AAACB91B7AF0EADB6028E3DB5C7EF3277A743C_AdjustorThunk','_Enumerator_Dispose_m899B0AD36DD88B8902AD5DE73D5EC7A8A5E8CAA0_AdjustorThunk','_NativeArray_1_Dispose_mC6CED4EB150C0212941C8559250E2F580E9B81B9_AdjustorThunk','_Enumerator_Dispose_m60DD335D21DCFE7DAD2D780D149B42538C2BD5DB_AdjustorThunk','_NativeArray_1_Dispose_mED2EA978276355A0FD146EAFE26985EFD2B6401E_AdjustorThunk','_Enumerator_Dispose_m44585CB81A33B0954B5A3EBB6D93CB9C57C72C36_AdjustorThunk','_NativeArray_1_Dispose_m1496682FBA56EC0ACF924DFBE7B94809FDF52EE5_AdjustorThunk','_Enumerator_Dispose_mF64B29A0DE4FED4E010A3DA4A140FB1D764B5ED2_AdjustorThunk','_NativeArray_1_Dispose_mED1F2F393DE2D63E6D61EA687BE8256E0E94A86E_AdjustorThunk','_Enumerator_Dispose_m9CBF491A92927B86FD6C07AA686DD33054A4A8AA_AdjustorThunk','_NativeArray_1_Dispose_m4CCB67032DAB978F005A369419C7F615F8D4B5EC_AdjustorThunk','_Enumerator_Dispose_mAFA900C07B53E03B5CCE02901A9D6EBD9DF238EE_AdjustorThunk','_NativeArray_1_Dispose_mB1FED55411DC93D6C5E978DB09260C5D887F4447_AdjustorThunk','_Enumerator_Dispose_mF450BCD212DC5B4AB0427A81CC646B8FABBE9FB8_AdjustorThunk','_NativeArray_1_Dispose_mFD108BB8ED91A10AC96ED4A5B35CCC445DA4707C_AdjustorThunk','_Enumerator_Dispose_m3634C72EE4709DD60C8058683786322EC5EAD914_AdjustorThunk','_NativeArray_1_Dispose_m8D9C062D162BA4FF0348792E7879F8D832515354_AdjustorThunk','_Enumerator_Dispose_mDF2480525EEB0D88B7637E92A3B379D3DC3BB4E3_AdjustorThunk','_NativeArray_1_Dispose_m93000A6E629DA8E3A85414C712336F836410164A_AdjustorThunk','_Enumerator_Dispose_mD6268F4344F627EC3C435C351DE0CE5C1A34D46B_AdjustorThunk','_BlobAssetReference_1_Dispose_m14877223DA74C457874E6080BC5610DA7CB3C1D8_AdjustorThunk','_BlobAssetReference_1_Dispose_m23DF57B782244D9C74617C193FB1CF5B49B20FFE_AdjustorThunk','_BlobAssetReference_1_Dispose_m2386336F3AD247A53C738CC3B45803A7D63993D4_AdjustorThunk','_BlobAssetReference_1_Dispose_m8A38672C23BA8BBC3C02C378D8E92E07AAE808A5_AdjustorThunk','_DestroyChunks_Execute_m8FEBFC73937CCF457E24E28BD770BB2212A85E75_AdjustorThunk','_SegmentSortMerge_1_Execute_m853E0FC7F075B850E1FCC2F788F1707E251594DA_AdjustorThunk','_CalculateEntityCountJob_Execute_m5B7C0BED24F44939885B87A902E105D9EC3D7935_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_Execute_m0476C42BCE5BEB4E464E25BBB1AD4EA6FA439323_AdjustorThunk','_ChunkPatchEntities_Execute_mE92FD02568C5805BD9BE232A9C994DE2B238BF74_AdjustorThunk','_MoveAllChunksJob_Execute_mEC08B0343DC7A361EB70673BFD08EA1354D660A0_AdjustorThunk','_MoveChunksJob_Execute_m1E6B36786D34534369DBF42D32F252F0127CBB28_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_Execute_mD775BDF18A5C6EFE9A3C3E87B0F967A0C44247CE_AdjustorThunk','_GatherChunksAndOffsetsJob_Execute_m2E05847DA13F1C5BE33ED9A8E897BC76317D6161_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_Execute_m7FE5C03CBEA2953C7C7D9DE554D5605412AC66DC_AdjustorThunk','_FindMissingChild_Execute_m46B9B0202454F0AC4E9211A0EA0CCC089C0533BD_AdjustorThunk','_FixupChangedChildren_Execute_m64311627C1A13D1C8DB90F68B57632036AA8933A_AdjustorThunk','_GatherChildEntities_Execute_m5010D5C102508F8A2F668B294E1A0827606E5808_AdjustorThunk','__ZN2bx16DefaultAllocatorD2Ev','__ZN2bx16DefaultAllocatorD0Ev','__ZN2bx10FileWriterD2Ev','__ZN2bx10FileWriterD0Ev','__ZN2bx10FileWriter5closeEv','__ZThn4_N2bx10FileWriterD1Ev','__ZThn4_N2bx10FileWriterD0Ev','__ZThn4_N2bx10FileWriter5closeEv','__ZThn8_N2bx10FileWriterD1Ev','__ZThn8_N2bx10FileWriterD0Ev','__ZThn12_N2bx10FileWriterD1Ev','__ZThn12_N2bx10FileWriterD0Ev','__ZN4bgfx2gl17RendererContextGLD2Ev','__ZN4bgfx2gl17RendererContextGLD0Ev','__ZN4bgfx2gl17RendererContextGL4flipEv','__ZN4bgfx2gl17RendererContextGL16updateTextureEndEv','__ZN2bx23StaticMemoryBlockWriterD2Ev','__ZN2bx23StaticMemoryBlockWriterD0Ev','__ZThn4_N2bx23StaticMemoryBlockWriterD1Ev','__ZThn4_N2bx23StaticMemoryBlockWriterD0Ev','__ZN2bx17StaticMemoryBlockD2Ev','__ZN2bx17StaticMemoryBlockD0Ev','__ZN2bx13WriterSeekerID2Ev','__ZN2bx11SizerWriterD0Ev','__ZThn4_N2bx11SizerWriterD1Ev','__ZThn4_N2bx11SizerWriterD0Ev','__ZN2bx13ReaderSeekerID2Ev','__ZN2bx12MemoryReaderD0Ev','__ZThn4_N2bx12MemoryReaderD1Ev','__ZThn4_N2bx12MemoryReaderD0Ev','__ZNSt3__214__shared_countD2Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi6EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi6EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi6EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_24GetUnquantizedTritWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_24GetUnquantizedTritWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_24GetUnquantizedTritWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_25GetUnquantizedQuintWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_25GetUnquantizedQuintWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_25GetUnquantizedQuintWeightEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_23GetUnquantizedTritValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_23GetUnquantizedTritValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_119TritQuantizationMapIXadL_ZNS2_23GetUnquantizedTritValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi8EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi8EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_118BitQuantizationMapILi8EEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_24GetUnquantizedQuintValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEED0Ev','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_24GetUnquantizedQuintValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE16__on_zero_sharedEv','__ZNSt3__220__shared_ptr_pointerIPN10astc_codec12_GLOBAL__N_120QuintQuantizationMapIXadL_ZNS2_24GetUnquantizedQuintValueEiiiEEEENS_14default_deleteIS4_EENS_9allocatorIS4_EEE21__on_zero_shared_weakEv','__ZN2bx7ReaderID2Ev','__ZN4bgfx2gl10LineReaderD0Ev','__ZN2bx14FileWriterImplD2Ev','__ZN2bx14FileWriterImplD0Ev','__ZN2bx14FileWriterImpl5closeEv','__ZThn4_N2bx14FileWriterImplD1Ev','__ZThn4_N2bx14FileWriterImplD0Ev','__ZThn4_N2bx14FileWriterImpl5closeEv','__ZThn8_N2bx14FileWriterImplD1Ev','__ZThn8_N2bx14FileWriterImplD0Ev','__ZThn12_N2bx14FileWriterImplD1Ev','__ZThn12_N2bx14FileWriterImplD0Ev','__ZN4bgfx16RendererContextID2Ev','__ZN4bgfx4noop19RendererContextNOOPD0Ev','__ZN4bgfx4noop19RendererContextNOOP4flipEv','__ZN4bgfx4noop19RendererContextNOOP16updateTextureEndEv','__ZN2bx10AllocatorID2Ev','__ZN4bgfx13AllocatorStubD0Ev','__ZN4bgfx9CallbackID2Ev','__ZN4bgfx12CallbackStubD0Ev','__ZN4bgfx12CallbackStub11profilerEndEv','__ZN4bgfx12CallbackStub10captureEndEv','__ZN4bgfx11CallbackC99D0Ev','__ZN4bgfx11CallbackC9911profilerEndEv','__ZN4bgfx11CallbackC9910captureEndEv','__ZN4bgfx12AllocatorC99D0Ev','__ZN10__cxxabiv116__shim_type_infoD2Ev','__ZN10__cxxabiv117__class_type_infoD0Ev','__ZNK10__cxxabiv116__shim_type_info5noop1Ev','__ZNK10__cxxabiv116__shim_type_info5noop2Ev','__ZN10__cxxabiv120__si_class_type_infoD0Ev','_JobChunk_Process_1_ProducerCleanupFn_Gen_m352E93F07A32882E32ED52B50FDADF61BA2BBE2A','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m352E93F07A32882E32ED52B50FDADF61BA2BBE2A','_JobChunk_Process_1_ProducerCleanupFn_Gen_mEFF9FE27C10151F6A7BE27CEFC250150977A85E3','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_mEFF9FE27C10151F6A7BE27CEFC250150977A85E3','_JobChunk_Process_1_ProducerCleanupFn_Gen_m37F2673249591B57C244D379ADB85ABBC3CC2CFB','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m37F2673249591B57C244D379ADB85ABBC3CC2CFB','_JobChunk_Process_1_ProducerCleanupFn_Gen_m7320113749E95A876E039F48FBD9179EB227DC70','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m7320113749E95A876E039F48FBD9179EB227DC70','_JobChunk_Process_1_ProducerCleanupFn_Gen_mD1E3B491F8993A9DE549EA484BB9BAD80CF6FEA6','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_mD1E3B491F8993A9DE549EA484BB9BAD80CF6FEA6','_JobChunk_Process_1_ProducerCleanupFn_Gen_mB25E482F8BF0799DDBEC2DF1B5376FE226FC6A32','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_mB25E482F8BF0799DDBEC2DF1B5376FE226FC6A32','_JobChunk_Process_1_ProducerCleanupFn_Gen_m01A280AA72A195C57733C63531E2A4EE64025B6C','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m01A280AA72A195C57733C63531E2A4EE64025B6C','_JobChunk_Process_1_ProducerCleanupFn_Gen_m20D20DCFA71B327BE2AA3383CF80BF03B4C65050','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m20D20DCFA71B327BE2AA3383CF80BF03B4C65050','_JobChunk_Process_1_ProducerCleanupFn_Gen_m9A4D5736129B8C258FB580E8424C763EAE7EF6D0','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m9A4D5736129B8C258FB580E8424C763EAE7EF6D0','_JobChunk_Process_1_ProducerCleanupFn_Gen_m56552195A0779E150DA88EAF890634E13C1134F9','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m56552195A0779E150DA88EAF890634E13C1134F9','_JobChunk_Process_1_ProducerCleanupFn_Gen_m1BD792634E2F5C8157F8FA6619BB74EA8865F1DD','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m1BD792634E2F5C8157F8FA6619BB74EA8865F1DD','_JobChunk_Process_1_ProducerCleanupFn_Gen_m21086F2B1D3E1D6658547EE85B22FCA496AE4284','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m21086F2B1D3E1D6658547EE85B22FCA496AE4284','_JobChunk_Process_1_ProducerCleanupFn_Gen_mAF7FBCAD884197CF5C78231F2515AD9E7DBD33AB','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_mAF7FBCAD884197CF5C78231F2515AD9E7DBD33AB','_JobChunk_Process_1_ProducerCleanupFn_Gen_m58F67B4C4A5E71EE6D3BCF680BD08E000A095195','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerCleanupFn_Gen_m58F67B4C4A5E71EE6D3BCF680BD08E000A095195','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mD2D2544FA11E9BD5699AFC7A5F0D070EF0D75A28','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mD2D2544FA11E9BD5699AFC7A5F0D070EF0D75A28','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m80FFED589098020394C2357B759C6923185715BF','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m80FFED589098020394C2357B759C6923185715BF','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m45EECE50EC4524E44810644562A41F06A287DDBE','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m45EECE50EC4524E44810644562A41F06A287DDBE','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m7A4A1C3F7F21092B8F829E38FE713B661AECABBB','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m7A4A1C3F7F21092B8F829E38FE713B661AECABBB','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mEA16758F97B5EC6DCE3A6A680A3280686D0405C8','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mEA16758F97B5EC6DCE3A6A680A3280686D0405C8','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mC161D54DE2EB3D828E0FAC7533A5B0EFA0C0AF3B','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_mC161D54DE2EB3D828E0FAC7533A5B0EFA0C0AF3B','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m912641F0083FF7DD8FE8A7ECEE9DC73112ED6107','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m912641F0083FF7DD8FE8A7ECEE9DC73112ED6107','_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m38833EE20E53A61C11E3E4F6480827058355FD5A','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerCleanupFn_Gen_m38833EE20E53A61C11E3E4F6480827058355FD5A','_Recieve_Callback_vi_m901A39D011E7C68803456BA39F19E99961E9E7BA','_ReversePInvokeWrapper_Recieve_Callback_vi_m901A39D011E7C68803456BA39F19E99961E9E7BA','_Recieve_Callback_vs_mEE825AA6553A96C3867BA1BBF9ADBCF93F203F61','_ReversePInvokeWrapper_Recieve_Callback_vs_mEE825AA6553A96C3867BA1BBF9ADBCF93F203F61','_GC_null_finalize_mark_proc','_GC_unreachable_finalize_mark_proc','__ZL12profiler_endP25bgfx_callback_interface_s','__ZL11capture_endP25bgfx_callback_interface_s','__ZN5Unity4Tiny2IOL9OnSuccessEP18emscripten_fetch_t','__ZN5Unity4Tiny2IOL7OnErrorEP18emscripten_fetch_t','_emscripten_glActiveTexture','_emscripten_glBlendEquation','_emscripten_glClear','_emscripten_glClearStencil','_emscripten_glCompileShader','_emscripten_glCullFace','_emscripten_glDeleteProgram','_emscripten_glDeleteShader','_emscripten_glDepthFunc','_emscripten_glDepthMask','_emscripten_glDisable','_emscripten_glDisableVertexAttribArray','_emscripten_glEnable','_emscripten_glEnableVertexAttribArray','_emscripten_glFrontFace','_emscripten_glGenerateMipmap','_emscripten_glLinkProgram','_emscripten_glStencilMask','_emscripten_glUseProgram','_emscripten_glValidateProgram','_emscripten_glEndQueryEXT','_emscripten_glBindVertexArrayOES','_emscripten_glReadBuffer','_emscripten_glEndQuery','_emscripten_glBindVertexArray','_emscripten_glBeginTransformFeedback','_emscripten_glDeleteSync','__ZN10__cxxabiv112_GLOBAL__N_19destruct_EPv',0,0,0,0,0,0,0,0,0,0];
var debug_table_vif = [0,'_emscripten_glUniform1f$legalf32','_emscripten_glVertexAttrib1f$legalf32',0];
var debug_table_viff = [0,'_emscripten_glUniform2f$legalf32','_emscripten_glVertexAttrib2f$legalf32',0];
var debug_table_vifff = [0,'_emscripten_glUniform3f$legalf32','_emscripten_glVertexAttrib3f$legalf32',0];
var debug_table_viffff = [0,'_emscripten_glUniform4f$legalf32','_emscripten_glVertexAttrib4f$legalf32',0];
var debug_table_vii = [0,'_F_E_Invoke_m1E7D15AD6038858E0705F85E5F4E61FD668D0A73','_ComponentSystem_OnBeforeCreateInternal_m04C4BDD690DDEA9E8525ED88B2829A659598CA21','_ComponentSystemBase_OnBeforeCreateInternal_mCDC97E13CEBE29CDC67589D3616B3CB74C0C232A','_vi_Invoke_m9195B70D2510F85AAC430E3747DE0F108E42339A','_vs_Invoke_m70300FF7F98F85B7DDFF9B872FFF01DB5F844702','_Action_1_Invoke_mA7AD3BD47F61364B25E63F2F2EA1C9B9085854B3','_Action_1_Invoke_m99605527B6EA6E7F378BADC2D30590F1DE67445C','_Connection_add_OnData_mE2878E55618D2D7DC66B87B81D1BBAF538B8AB69_AdjustorThunk','_Connection_remove_OnData_mC10E2C4BB5493CDB94271721249EF71EE3EDB2AB_AdjustorThunk','_Connection_add_OnClose_mA90673A74D306C688FEDC6FECF0555E5ECFAC1DE_AdjustorThunk','_Connection_remove_OnClose_mD109BE0C33133CC874FB7790ECE54EFA950164FC_AdjustorThunk','_Connection_Send_m7EE7500CD192D2BC25BDE41FCA23B3B6E6753681_AdjustorThunk','_F_D_1_Invoke_m55439EF872363DEB4F86418BB491C1AD57F9F917','_F_D_1_Invoke_mFDD68CE4B8CFB4728D21022FE9B72FB8A8102F9D','_JobComponentSystem_OnBeforeCreateInternal_mE65CEE7ABE4CBB948AD5FE9FE467689ABD2DF104','_Enumerator_get_Current_m6936778935EA24F3DD0734AFDE445B129D5561FA_AdjustorThunk','_Enumerator_get_Current_mBDB7F817586E81B6FABBACA7F32A2384B91FC4D5_AdjustorThunk','_Enumerator_get_Current_m64B3DBE35125D2D53765997F3D4B692457436E41_AdjustorThunk','_Enumerator_get_Current_mA19E7FB087F03ED3E46A5D42C4BEC21F4F3674BB_AdjustorThunk','_Enumerator_get_Current_mB0EF4B7CC3D2D7384062F2984041DE839CB97D9B_AdjustorThunk','_Enumerator_get_Current_mA835D30093345AB204E575329E6F2B701E0409A8_AdjustorThunk','_Enumerator_get_Current_mB9D9FDDC0DF6DF7F5EBB116C4275BFBDA80CC669_AdjustorThunk','_Enumerator_get_Current_m6B235E631CC9E05A70B93235826992CD5A0670BA_AdjustorThunk','_Enumerator_get_Current_mD3DB45789C74D2A0277D19B627BF9A18514C0289_AdjustorThunk','_Enumerator_get_Current_m50A3F08A3C30BDFB21CA740C36331A80A3C952B3_AdjustorThunk','_Enumerator_get_Current_mE658C1587A501006333184DA39C65B78142CCB9A_AdjustorThunk','_Enumerator_get_Current_mCE4D530C82FFE49CD832F491B067A3255E6B0C43_AdjustorThunk','_Enumerator_get_Current_m89117DE9B535EC905DDC90640395EFC8BA12E612_AdjustorThunk','_Enumerator_get_Current_m0C03B69872655DC0812F63412D9F1FA99B7B352C_AdjustorThunk','_Enumerator_get_Current_mC6D26FEC0D0698591A1EBF1516022AE7B0C209C5_AdjustorThunk','_Enumerator_get_Current_m88E52752C26AC3128229BBB11E0674F8D6255874_AdjustorThunk','_Enumerator_get_Current_m9AE2BDB61FE6259CC8C0A91AADB964A413608177_AdjustorThunk','_Enumerator_get_Current_m54F2E81AE7128775B16B0B76A2B18934BCCE8D46_AdjustorThunk','_Enumerator_get_Current_mC5D59CFFE7D8FA60A8168E6BEF1874C687D301BC_AdjustorThunk','_Enumerator_get_Current_m8D47870963D93A04CD0B8BA6A92AF15ACA230ECB_AdjustorThunk','_Enumerator_get_Current_mA4F6BB2B55EE1B3A1F1218AB74E13CD75E5CB8F5_AdjustorThunk','_Enumerator_get_Current_mFE1988F6668EA12256906F1A706AECBF5B6C1E98_AdjustorThunk','_Enumerator_get_Current_m4DE50196CC2A0347B5E683FE478A507A6010084A_AdjustorThunk','_Enumerator_get_Current_mB9A0481BCA3082EB003DB394B5CA692EBAF72240_AdjustorThunk','_Enumerator_get_Current_m715ED40B58A80D078A453265EB9096DE9093EE4C_AdjustorThunk','_Enumerator_get_Current_mFDEB7E27B5E8EAF8C27646BBEA69337F9ACD19C7_AdjustorThunk','_Enumerator_get_Current_m6950DD6DAA7882773B5B708C5208713BFC66CD57_AdjustorThunk','_Enumerator_get_Current_m9329E297BF1F56F2D6134E77FB6A6FB2B414C342_AdjustorThunk','_Enumerator_get_Current_mC3B2241441E0387CC8DBF84E5D7744085CE2FD42_AdjustorThunk','_Enumerator_get_Current_m112E4035988BC2646A782AE549FD5E26AB83849A_AdjustorThunk','_Enumerator_get_Current_m32CC652B8845AF99E40575A6909A723047194A6A_AdjustorThunk','_Enumerator_get_Current_m5D47DE681D8D54D1A8AAAA63399E22E83E7F1272_AdjustorThunk','_Enumerator_get_Current_mFACAA08992A7D911E895946DFA270B344ED63A01_AdjustorThunk','_Enumerator_get_Current_m05CC4AFA76AEE1D44900F35F84495F9238964493_AdjustorThunk','_Enumerator_get_Current_m2702369876E24F608EFEDD4525E36BDD69947FF6_AdjustorThunk','_Enumerator_get_Current_mDE763A0F00FDC7664C4E71033C09268C54FA2DAD_AdjustorThunk','_Enumerator_get_Current_m3E9297EAA261D4C024C4A88EE33BBC9638A33483_AdjustorThunk','_Enumerator_get_Current_m745A178F27749F9D4C9D1E0DEA63DC64C220B569_AdjustorThunk','_Enumerator_get_Current_m656FFAFE0407F289DCD7BB68EA9005FD110EEE67_AdjustorThunk','_Enumerator_get_Current_m3331645E00043AA38BD9DF22D62D9FC484462279_AdjustorThunk','_Enumerator_get_Current_mB47286D2BFD346260FF0A7622943BAD3097E7238_AdjustorThunk','_Enumerator_get_Current_mE073CADD40DCE3F90991F6C268B4BE53858F7E3C_AdjustorThunk','_Enumerator_get_Current_mCF3ABD4B9D30B21363F30DD7E79984B2355F1315_AdjustorThunk','_Enumerator_get_Current_m6C37EB6A8668FE6AE42E732D54BD5704417FEBE8_AdjustorThunk','_Enumerator_get_Current_mDE0C6C18E84F224781A94AEC53A28499B8370535_AdjustorThunk','_Enumerator_get_Current_m18E13E37A31204F0CEB698E96F37580B3D642910_AdjustorThunk','_Enumerator_get_Current_m91B461C3A15F76713B5126426786EEC9DA616251_AdjustorThunk','_Enumerator_get_Current_m7E0CE5A4EDE5AC1F2CE4AAE5EA66EE4FBA435964_AdjustorThunk','_Enumerator_get_Current_mF4A064989B78CAB2E4658F154667B37F08837AF6_AdjustorThunk','_Enumerator_get_Current_m559F9F90799BD24BAB46CCB38E922227C2E03228_AdjustorThunk','_Enumerator_get_Current_m99B2E366C417AAF99AAE5BF4C3DB9CFA4267A49F_AdjustorThunk','_Enumerator_get_Current_m9BA9B411F80B87E1A61F4D75F515C2B465B3962F_AdjustorThunk','_Enumerator_get_Current_mB849FEA56C6883D0510B784CEF74B13AE9BFB3A1_AdjustorThunk','_Enumerator_get_Current_m56BF796F430BFEFF21A57019BCC2B772643A76D0_AdjustorThunk','_Enumerator_get_Current_m978C5FEC7F015EC5287E54DBD55A4336E719E07F_AdjustorThunk','_Enumerator_get_Current_m6E606E0796E906FE1145BF401D6AD36FB3EDE4A0_AdjustorThunk','_Enumerator_get_Current_m0587BA37E42F293B110C1EB00F2421FA69CC73AF_AdjustorThunk','_Enumerator_get_Current_mF497F9D9A2607698F05516A9BF5A24A07EE3978B_AdjustorThunk','_Enumerator_get_Current_mC41FE6A4712A42090FD0B49F4D35B33125D9D9EE_AdjustorThunk','_Enumerator_get_Current_m42E8272D11F300296CFF63C13388477E222B099E_AdjustorThunk','_Enumerator_get_Current_mD94C8E2D37DE53891C5772A4C939410036C0E292_AdjustorThunk','_Enumerator_get_Current_mF72E30F258259E576C5666EBCFEA4A9BDA5977AB_AdjustorThunk','_Enumerator_get_Current_m2092D4C55E851E144C9BF234A3397E561D839F5F_AdjustorThunk','_Enumerator_get_Current_mD13355C38568484B10FA90D44BA7A6D12F74435F_AdjustorThunk','_GatherComponentDataJob_1_PrepareJobAtExecuteTimeFn_Gen_m53226863CD59CCDCEA3275B5E0ED6A8C4F83F6CA_AdjustorThunk','_GatherComponentDataJob_1_CleanupJobFn_Gen_mD552AD9BFC151A00C9A6D5AE35622769D64EA9F6_AdjustorThunk','_ManagedJobDelegate_Invoke_m6928DC001962A045DE74B7F1310D972FE3A7696F','_GatherEntitiesJob_PrepareJobAtExecuteTimeFn_Gen_m8321C89511307CAC65822ABC980405B441C73122_AdjustorThunk','_GatherEntitiesJob_CleanupJobFn_Gen_mB87C76B7F35C22269354DC1777533B0004A545EC_AdjustorThunk','_SubmitSimpleLitMeshJob_PrepareJobAtExecuteTimeFn_Gen_m07961857B0C4FB88B86994DFCDE83E83EDBF54A2_AdjustorThunk','_SubmitSimpleLitMeshJob_CleanupJobFn_Gen_m25803C3D6CBE879C521272526620087CF39E68F9_AdjustorThunk','_BuildEntityGuidHashMapJob_PrepareJobAtExecuteTimeFn_Gen_m68EE3A5F62CEC38D345E2FFE0DA9F781CD983333_AdjustorThunk','_BuildEntityGuidHashMapJob_CleanupJobFn_Gen_m3BCE259A491B480B2C36101AED5053CB41F6877F_AdjustorThunk','_ToCompositeRotation_PrepareJobAtExecuteTimeFn_Gen_mAC3DB22BE9FACAE2FCC117DFE22094BDFC3D1E63_AdjustorThunk','_ToCompositeRotation_CleanupJobFn_Gen_m8C444F7A430728FA5242691098E0E5DE069EC7C0_AdjustorThunk','_ToCompositeScale_PrepareJobAtExecuteTimeFn_Gen_m7E19B6D81F298B3200298406BC06B99C900A6698_AdjustorThunk','_ToCompositeScale_CleanupJobFn_Gen_mBA9026CBE983CA569495E91E3F9D6D0BB216C6E9_AdjustorThunk','_UpdateHierarchy_PrepareJobAtExecuteTimeFn_Gen_mE5943AA360841797342CC8E8422309E33F92361D_AdjustorThunk','_UpdateHierarchy_CleanupJobFn_Gen_m5419C26A4C7E1F7FE43157EA877E56D2E083405E_AdjustorThunk','_ToChildParentScaleInverse_PrepareJobAtExecuteTimeFn_Gen_mDBA7BC5B07B408C32E62933D8CFCAD2D0C1E11A1_AdjustorThunk','_ToChildParentScaleInverse_CleanupJobFn_Gen_m3D71AB9AB129F0B4760FC87F58685705DA40109F_AdjustorThunk','_GatherChangedParents_PrepareJobAtExecuteTimeFn_Gen_m3ECE0CE3618512A4619CFD6B9863AE21E2A260CF_AdjustorThunk','_GatherChangedParents_CleanupJobFn_Gen_m9C45E9507F766EF820CAD99F0B7B7BAECE5A8A43_AdjustorThunk','_PostRotationEulerToPostRotation_PrepareJobAtExecuteTimeFn_Gen_mED17ECA34F68515DD5E225C82C7F64F11DF8610A_AdjustorThunk','_PostRotationEulerToPostRotation_CleanupJobFn_Gen_m58155B94E373C8BD56F0F73C9228ADFA255B43A5_AdjustorThunk','_RotationEulerToRotation_PrepareJobAtExecuteTimeFn_Gen_mEC8C58D1FE49E7FA5D8594633BFA57D1C3C93805_AdjustorThunk','_RotationEulerToRotation_CleanupJobFn_Gen_mB4336C07420DEB151D73ADB02D768CDDA150E739_AdjustorThunk','_TRSToLocalToParent_PrepareJobAtExecuteTimeFn_Gen_m3BE3C4EDCE5D336B06B2B20994D4FDE213A83B52_AdjustorThunk','_TRSToLocalToParent_CleanupJobFn_Gen_mF57E707E177D37BED2E75C20AFE2E322DD349E02_AdjustorThunk','_TRSToLocalToWorld_PrepareJobAtExecuteTimeFn_Gen_m67AA6DF57D0E5A2D2C7D89522E285C2B527D5D08_AdjustorThunk','_TRSToLocalToWorld_CleanupJobFn_Gen_m88FAD67D9FC2ADF36CABF91C9616D032EE91C947_AdjustorThunk','_ToWorldToLocal_PrepareJobAtExecuteTimeFn_Gen_m2622024B3A7C4AA8BDC92BBD2C7D020D3226A1E4_AdjustorThunk','_ToWorldToLocal_CleanupJobFn_Gen_mEE911E122C0B74532CB81D82563307D793F0FADF_AdjustorThunk','_DestroyChunks_PrepareJobAtExecuteTimeFn_Gen_m9BCE64F53DDDAEFE25ED2B2C15C8F1A2B41EFF1C_AdjustorThunk','_DestroyChunks_CleanupJobFn_Gen_mE15E6F7A36B9DEF010D6DEA4A73274B1A735D11B_AdjustorThunk','_SegmentSortMerge_1_PrepareJobAtExecuteTimeFn_Gen_m4A781B153B2BB10171881F01DC732D6F45A91F20_AdjustorThunk','_SegmentSortMerge_1_CleanupJobFn_Gen_mF26CA26DAF009BEF2BD032098C2E38582AEB49DA_AdjustorThunk','_CalculateEntityCountJob_PrepareJobAtExecuteTimeFn_Gen_m6D2B8EDC6BBDEBA413FE8207478D8844C3455D59_AdjustorThunk','_CalculateEntityCountJob_CleanupJobFn_Gen_m75028A8E1DE744E96DA6C58D080E3CA012A2B9F7_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_PrepareJobAtExecuteTimeFn_Gen_m58F7E83F3B1659BB6DF5D790ABEA064F81A552CA_AdjustorThunk','_EntityBatchFromEntityChunkDataShared_CleanupJobFn_Gen_mD704DB71855D082ED3672D6CE190D00DDDEC1F96_AdjustorThunk','_ChunkPatchEntities_PrepareJobAtExecuteTimeFn_Gen_m3F04BAD84A84519C8F14A70707DF22F99C588AE2_AdjustorThunk','_ChunkPatchEntities_CleanupJobFn_Gen_mAA610413772EBD10919F7FE57629E6ADED6A4EC1_AdjustorThunk','_MoveAllChunksJob_PrepareJobAtExecuteTimeFn_Gen_m4019488A8B9B504872711A7398D16392BBE436FD_AdjustorThunk','_MoveAllChunksJob_CleanupJobFn_Gen_m7A6F013E3D2D5605A5C9AAD2F60AC5FE19A113EA_AdjustorThunk','_MoveChunksJob_PrepareJobAtExecuteTimeFn_Gen_m03FDC93253D4A23034577BAFD86BD4328D31B56E_AdjustorThunk','_MoveChunksJob_CleanupJobFn_Gen_m95A90FAE42B9ECBC428528B7F6466B7A40F8621E_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_PrepareJobAtExecuteTimeFn_Gen_mED5EF3EDA73F32EA2F8FFFEEDB06BEB3E9A79E1C_AdjustorThunk','_MoveFilteredChunksBetweenArchetypexJob_CleanupJobFn_Gen_m3CFC15E653A40B906D9B52095BF20214489BEE89_AdjustorThunk','_GatherChunksAndOffsetsJob_PrepareJobAtExecuteTimeFn_Gen_mD723F76E7065D2118344AEDDC97489851F70C229_AdjustorThunk','_GatherChunksAndOffsetsJob_CleanupJobFn_Gen_mBACC1F9BEA35956913391CFE7F4EA91B62BDB0E5_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_PrepareJobAtExecuteTimeFn_Gen_mD3C9C311F36D4709F5B1ADF6744EE756F09CE2A8_AdjustorThunk','_GatherChunksAndOffsetsWithFilteringJob_CleanupJobFn_Gen_m94A007C00D602E79DCF850536F79E85D2B5C9DB7_AdjustorThunk','_FindMissingChild_PrepareJobAtExecuteTimeFn_Gen_mA48763120267CBA1130396E3046F22C92B920C49_AdjustorThunk','_FindMissingChild_CleanupJobFn_Gen_mDD4625BD72FC433C1C606B881D547F857D93344D_AdjustorThunk','_FixupChangedChildren_PrepareJobAtExecuteTimeFn_Gen_mEDC50C3AFD5D4FCFD83991028847D57AE69821C5_AdjustorThunk','_FixupChangedChildren_CleanupJobFn_Gen_mD1CAFA1732DC079B30F0E174F7319C6912C86C31_AdjustorThunk','_GatherChildEntities_PrepareJobAtExecuteTimeFn_Gen_m00A8FD5008F30DAA33B623D408461931A8326DB6_AdjustorThunk','_GatherChildEntities_CleanupJobFn_Gen_m8E2A880EBF87CAF9725B87CF72DF8C324BF4935A_AdjustorThunk','_SegmentSort_1_Execute_m5F0D1D64BE1DE540CE0DBE1B64C60B166A1203E2_AdjustorThunk','_SegmentSort_1_PrepareJobAtExecuteTimeFn_Gen_m5D0D27EC4DF321BA55D44D07C631B861CF677013_AdjustorThunk','_SegmentSort_1_CleanupJobFn_Gen_mA8D35FC6F40E3E0D1860513E3AE90EF5A84B8682_AdjustorThunk','_GatherEntityInChunkForEntities_Execute_mD9F62BBDE672B6639B65B54A09C90001351F07BE_AdjustorThunk','_GatherEntityInChunkForEntities_PrepareJobAtExecuteTimeFn_Gen_m4A0F3CCF1D445A20D727CF6DB640EDEE7ADDE6B1_AdjustorThunk','_GatherEntityInChunkForEntities_CleanupJobFn_Gen_m8A25DBAE48B79060585AE4209923064722D509BA_AdjustorThunk','_RemapAllArchetypesJob_Execute_m4B3E811048467D8B01ED1C408EFDC639BC23B389_AdjustorThunk','_RemapAllArchetypesJob_PrepareJobAtExecuteTimeFn_Gen_m78FB98BDBF92852F406011795420DC2B2C4B9D2D_AdjustorThunk','_RemapAllArchetypesJob_CleanupJobFn_Gen_mCB61022920DBE77FCEFDA309EDC8870C954EFF26_AdjustorThunk','_RemapAllChunksJob_Execute_mB2A2BDBA45FFBDD48D00F625CD1E2CF288FEFDAB_AdjustorThunk','_RemapAllChunksJob_PrepareJobAtExecuteTimeFn_Gen_m69EA91E200D18F4677E5ED226151BBBDA3471587_AdjustorThunk','_RemapAllChunksJob_CleanupJobFn_Gen_m8B885C2193CA026F63D555B60A6C25E61065CA4C_AdjustorThunk','_RemapChunksFilteredJob_Execute_m1BE2A16BA3D906C63355960BCFCBC32DEE568266_AdjustorThunk','_RemapChunksFilteredJob_PrepareJobAtExecuteTimeFn_Gen_m393CD1C803D001B44680595E8D4FEF937F08CC6D_AdjustorThunk','_RemapChunksFilteredJob_CleanupJobFn_Gen_m6A1C651A59DB458B084022A329326A8748DE870B_AdjustorThunk','_RemapManagedArraysJob_Execute_m1E359E03140722B1FB8E6473DB799334C7017A41_AdjustorThunk','_RemapManagedArraysJob_PrepareJobAtExecuteTimeFn_Gen_mDE6C4EEF82318477EA74F0A482CEC0BF43136936_AdjustorThunk','_RemapManagedArraysJob_CleanupJobFn_Gen_m01C375C94218A2CFE139EBAB60EB371DFDD72184_AdjustorThunk','_GatherChunks_Execute_m93D984555F5A67D6304412EB723597C8872CBC1C_AdjustorThunk','_GatherChunks_PrepareJobAtExecuteTimeFn_Gen_m01455E77C09A899C88190705624E57F6C169F99C_AdjustorThunk','_GatherChunks_CleanupJobFn_Gen_mF4EF0E7D4488DF7101F47A535D41CC5B2D5E1606_AdjustorThunk','_GatherChunksWithFiltering_Execute_mD26E36056038569B432F3C57C00E898346E6A863_AdjustorThunk','_GatherChunksWithFiltering_PrepareJobAtExecuteTimeFn_Gen_mC42992D3E1B183160324236233DABD9521A1EF66_AdjustorThunk','_GatherChunksWithFiltering_CleanupJobFn_Gen_m91C6E595B0D33283980991F28993EE1F739CF3F0_AdjustorThunk','_JoinChunksJob_Execute_m02E9EDAFF4FB39EC656D7766889F0C5FFB47C6BC_AdjustorThunk','_JoinChunksJob_PrepareJobAtExecuteTimeFn_Gen_mF153D83B354AB4A4CA3743FDEABF2C72D7224B61_AdjustorThunk','_JoinChunksJob_CleanupJobFn_Gen_m12A422D06E1E72C835CDC2EE6365F2E0B5D9E6BD_AdjustorThunk','_GC_default_warn_proc','__ZN4bgfx2gl17RendererContextGL18destroyIndexBufferENS_17IndexBufferHandleE','__ZN4bgfx2gl17RendererContextGL19destroyVertexLayoutENS_18VertexLayoutHandleE','__ZN4bgfx2gl17RendererContextGL19destroyVertexBufferENS_18VertexBufferHandleE','__ZN4bgfx2gl17RendererContextGL25destroyDynamicIndexBufferENS_17IndexBufferHandleE','__ZN4bgfx2gl17RendererContextGL26destroyDynamicVertexBufferENS_18VertexBufferHandleE','__ZN4bgfx2gl17RendererContextGL13destroyShaderENS_12ShaderHandleE','__ZN4bgfx2gl17RendererContextGL14destroyProgramENS_13ProgramHandleE','__ZN4bgfx2gl17RendererContextGL14destroyTextureENS_13TextureHandleE','__ZN4bgfx2gl17RendererContextGL18destroyFrameBufferENS_17FrameBufferHandleE','__ZN4bgfx2gl17RendererContextGL14destroyUniformENS_13UniformHandleE','__ZN4bgfx2gl17RendererContextGL24invalidateOcclusionQueryENS_20OcclusionQueryHandleE','__ZN4bgfx2gl17RendererContextGL9blitSetupERNS_19TextVideoMemBlitterE','__ZN2bx6packA8EPvPKf','__ZN2bx8unpackA8EPfPKv','__ZN2bx6packR8EPvPKf','__ZN2bx8unpackR8EPfPKv','__ZN2bx7packR8IEPvPKf','__ZN2bx9unpackR8IEPfPKv','__ZN2bx7packR8UEPvPKf','__ZN2bx9unpackR8UEPfPKv','__ZN2bx7packR8SEPvPKf','__ZN2bx9unpackR8SEPfPKv','__ZN2bx7packR16EPvPKf','__ZN2bx9unpackR16EPfPKv','__ZN2bx8packR16IEPvPKf','__ZN2bx10unpackR16IEPfPKv','__ZN2bx8packR16UEPvPKf','__ZN2bx10unpackR16UEPfPKv','__ZN2bx8packR16FEPvPKf','__ZN2bx10unpackR16FEPfPKv','__ZN2bx8packR16SEPvPKf','__ZN2bx10unpackR16SEPfPKv','__ZN2bx8packR32IEPvPKf','__ZN2bx10unpackR32IEPfPKv','__ZN2bx8packR32UEPvPKf','__ZN2bx10unpackR32UEPfPKv','__ZN2bx8packR32FEPvPKf','__ZN2bx10unpackR32FEPfPKv','__ZN2bx7packRg8EPvPKf','__ZN2bx9unpackRg8EPfPKv','__ZN2bx8packRg8IEPvPKf','__ZN2bx10unpackRg8IEPfPKv','__ZN2bx8packRg8UEPvPKf','__ZN2bx10unpackRg8UEPfPKv','__ZN2bx8packRg8SEPvPKf','__ZN2bx10unpackRg8SEPfPKv','__ZN2bx8packRg16EPvPKf','__ZN2bx10unpackRg16EPfPKv','__ZN2bx9packRg16IEPvPKf','__ZN2bx11unpackRg16IEPfPKv','__ZN2bx9packRg16UEPvPKf','__ZN2bx11unpackRg16UEPfPKv','__ZN2bx9packRg16FEPvPKf','__ZN2bx11unpackRg16FEPfPKv','__ZN2bx9packRg16SEPvPKf','__ZN2bx11unpackRg16SEPfPKv','__ZN2bx9packRg32IEPvPKf','__ZN2bx11unpackRg32IEPfPKv','__ZN2bx9packRg32UEPvPKf','__ZN2bx11unpackRg32UEPfPKv','__ZN2bx9packRg32FEPvPKf','__ZN2bx11unpackRg32FEPfPKv','__ZN2bx8packRgb8EPvPKf','__ZN2bx10unpackRgb8EPfPKv','__ZN2bx9packRgb8SEPvPKf','__ZN2bx11unpackRgb8SEPfPKv','__ZN2bx9packRgb8IEPvPKf','__ZN2bx11unpackRgb8IEPfPKv','__ZN2bx9packRgb8UEPvPKf','__ZN2bx11unpackRgb8UEPfPKv','__ZN2bx11packRgb9E5FEPvPKf','__ZN2bx13unpackRgb9E5FEPfPKv','__ZN2bx9packBgra8EPvPKf','__ZN2bx11unpackBgra8EPfPKv','__ZN2bx9packRgba8EPvPKf','__ZN2bx11unpackRgba8EPfPKv','__ZN2bx10packRgba8IEPvPKf','__ZN2bx12unpackRgba8IEPfPKv','__ZN2bx10packRgba8UEPvPKf','__ZN2bx12unpackRgba8UEPfPKv','__ZN2bx10packRgba8SEPvPKf','__ZN2bx12unpackRgba8SEPfPKv','__ZN2bx10packRgba16EPvPKf','__ZN2bx12unpackRgba16EPfPKv','__ZN2bx11packRgba16IEPvPKf','__ZN2bx13unpackRgba16IEPfPKv','__ZN2bx11packRgba16UEPvPKf','__ZN2bx13unpackRgba16UEPfPKv','__ZN2bx11packRgba16FEPvPKf','__ZN2bx13unpackRgba16FEPfPKv','__ZN2bx11packRgba16SEPvPKf','__ZN2bx13unpackRgba16SEPfPKv','__ZN2bx11packRgba32IEPvPKf','__ZN2bx13unpackRgba32IEPfPKv','__ZN2bx11packRgba32UEPvPKf','__ZN2bx13unpackRgba32UEPfPKv','__ZN2bx11packRgba32FEPvPKf','__ZN2bx13unpackRgba32FEPfPKv','__ZN2bx10packR5G6B5EPvPKf','__ZN2bx12unpackR5G6B5EPfPKv','__ZN2bx9packRgba4EPvPKf','__ZN2bx11unpackRgba4EPfPKv','__ZN2bx10packRgb5a1EPvPKf','__ZN2bx12unpackRgb5a1EPfPKv','__ZN2bx11packRgb10A2EPvPKf','__ZN2bx13unpackRgb10A2EPfPKv','__ZN2bx12packRG11B10FEPvPKf','__ZN2bx14unpackRG11B10FEPfPKv','__ZN2bx7packR24EPvPKf','__ZN2bx9unpackR24EPfPKv','__ZN2bx9packR24G8EPvPKf','__ZN2bx11unpackR24G8EPfPKv','__ZN4bgfx4noop19RendererContextNOOP18destroyIndexBufferENS_17IndexBufferHandleE','__ZN4bgfx4noop19RendererContextNOOP19destroyVertexLayoutENS_18VertexLayoutHandleE','__ZN4bgfx4noop19RendererContextNOOP19destroyVertexBufferENS_18VertexBufferHandleE','__ZN4bgfx4noop19RendererContextNOOP25destroyDynamicIndexBufferENS_17IndexBufferHandleE','__ZN4bgfx4noop19RendererContextNOOP26destroyDynamicVertexBufferENS_18VertexBufferHandleE','__ZN4bgfx4noop19RendererContextNOOP13destroyShaderENS_12ShaderHandleE','__ZN4bgfx4noop19RendererContextNOOP14destroyProgramENS_13ProgramHandleE','__ZN4bgfx4noop19RendererContextNOOP14destroyTextureENS_13TextureHandleE','__ZN4bgfx4noop19RendererContextNOOP18destroyFrameBufferENS_17FrameBufferHandleE','__ZN4bgfx4noop19RendererContextNOOP14destroyUniformENS_13UniformHandleE','__ZN4bgfx4noop19RendererContextNOOP24invalidateOcclusionQueryENS_20OcclusionQueryHandleE','__ZN4bgfx4noop19RendererContextNOOP9blitSetupERNS_19TextVideoMemBlitterE','_JobStruct_1_ProducerExecuteFn_Gen_m95CBD8D957F15017013E904D8BE1A19079BEDBF6','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m95CBD8D957F15017013E904D8BE1A19079BEDBF6','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m5409D32EF29144F8E51FF8B2CAD6094C3A9056C8','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m5409D32EF29144F8E51FF8B2CAD6094C3A9056C8','_JobChunk_Process_1_ProducerExecuteFn_Gen_m20D81F45903C3CB82D578B893CE56DD2CF3A8B8E','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m20D81F45903C3CB82D578B893CE56DD2CF3A8B8E','_Recieve_Callback_vii_m38ED8B8250E4CEADBD3D5D790CE8898E0D15B9CA','_ReversePInvokeWrapper_Recieve_Callback_vii_m38ED8B8250E4CEADBD3D5D790CE8898E0D15B9CA','_U3CU3Ec__DisplayClass5_1_U3COnUpdateU3Eb__5_mD816B7A6CBDAA3AD030BD9A17D5E21E0B68BCF80','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__6_m7B17AAAAC1364083833ADDA76C39FE04B8002DC2','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__3_m25CD0853433F66C43273EE996AB2C630A2B98162','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__4_m29F2810FCFCD7F5FF7BC8EFDF56EADBCE54B9AC9','_U3CU3Ec_U3COnUpdateU3Eb__1_0_m9478441D6C1037A723A1A0EB6001CE4B38025BE5','_U3CU3Ec_U3COnUpdateU3Eb__1_1_mAD7781674849ED6B84EAE1D3AF30F6E25E3B6572','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__2_m18EEE8252E3429D6774CB1E88DEEA4D39993DC09','_U3CU3Ec__DisplayClass10_0_U3CBuildDefaultRenderGraphU3Eb__0_m86CA409F74E32D2F656DAED39FB3BB32AFF23609','_U3CU3Ec__DisplayClass42_0_U3CReloadAllImagesU3Eb__0_m45601991ABABEC5270E131FBF41915DAE94C090C','_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__1_m3579E2DCA5A062EABAAE7C648B2B37722BC7F90F','_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__2_mCF6598A303BFB98D0A270B85EED5FD80265EF5FB','_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__1_m9A4B7778AEA8422F34F5AE3EB64EFEBA4CC7F11E','_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__2_m018B4DAD124655974B44A00B446BF734FA79E719','_JobChunk_Process_1_ProducerExecuteFn_Gen_mF24A6DF29FA90E2F10AB546B1BED0FD93E50D95E','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mF24A6DF29FA90E2F10AB546B1BED0FD93E50D95E','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__0_m40BC334338A4D65E1CB7147BDA008FFD8EC63C09','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_mBB945BF042B0B8142B48C98784E96B6CECDDF05A','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__1_m07BCF222F9E4856B4B5760A718B36F6CC4360C74','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__4_mA2EA38AB4C7F86D805C722F57681CE2756094290','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__5_mE11458B12BBAABA0C51C014D5D35E6245FD7812C','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__6_mD1ED596DEA3F60ADA9FCE9CA35333A0310FA9ED5','_JobStruct_1_ProducerExecuteFn_Gen_m9A800A08900F3AE89FD6CCA733478857FFE392DE','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m9A800A08900F3AE89FD6CCA733478857FFE392DE','_JobStruct_1_ProducerExecuteFn_Gen_mC68BC278F6AD2B36EFBBB3B85F23289B65FC4928','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_mC68BC278F6AD2B36EFBBB3B85F23289B65FC4928','_JobStruct_1_ProducerExecuteFn_Gen_m9F3DF1243D230ADF0B4DBA21F152A7B69E5B7A01','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m9F3DF1243D230ADF0B4DBA21F152A7B69E5B7A01','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m14BBE3F7B169ADF49FB879EDB807D74680DCAC12','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m14BBE3F7B169ADF49FB879EDB807D74680DCAC12','_JobStruct_1_ProducerExecuteFn_Gen_m031EFEE1AA99761320856AC863CAC606B3FA36B0','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m031EFEE1AA99761320856AC863CAC606B3FA36B0','_JobStruct_1_ProducerExecuteFn_Gen_m74BEC5DA15A5B560F54BA09783EE1245A9A0A4A9','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m74BEC5DA15A5B560F54BA09783EE1245A9A0A4A9','_JobStruct_1_ProducerExecuteFn_Gen_m6191945CCA4FD37B31C856F28060C985598603A0','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m6191945CCA4FD37B31C856F28060C985598603A0','_JobStruct_1_ProducerExecuteFn_Gen_m799586BAC6A063FDDF71923B6481FA3F677ACD6D','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m799586BAC6A063FDDF71923B6481FA3F677ACD6D','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m8F4432792A36C69E1325D8CBBD19452AB239E13B','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m8F4432792A36C69E1325D8CBBD19452AB239E13B','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m1A750F7F52F392BF54A0915E81F1C56C31CF0F0D','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m1A750F7F52F392BF54A0915E81F1C56C31CF0F0D','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mD972CCC3FB94A03C129464EE749AB382285C303A','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mD972CCC3FB94A03C129464EE749AB382285C303A','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mE41E44B3BA09BAF3B7A5D1D1D255DD3AF28277AE','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mE41E44B3BA09BAF3B7A5D1D1D255DD3AF28277AE','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m1EF9FBF2DFC1E025CE18A11618D2B2AC0D750997','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m1EF9FBF2DFC1E025CE18A11618D2B2AC0D750997','_JobStruct_1_ProducerExecuteFn_Gen_m6C9B14E42F6A11421FD115496A381CA53052382F','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m6C9B14E42F6A11421FD115496A381CA53052382F','_JobStruct_1_ProducerExecuteFn_Gen_mE782C890B78BDB3A29D1B1CC7CEF562FF777058F','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_mE782C890B78BDB3A29D1B1CC7CEF562FF777058F','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mB33A3B8F893FC4D225D68B58A4C4CC9B54DB1F07','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_mB33A3B8F893FC4D225D68B58A4C4CC9B54DB1F07','_JobChunk_Process_1_ProducerExecuteFn_Gen_mC19217D340D13A25D2DBFBCE9C1687723A303EB5','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mC19217D340D13A25D2DBFBCE9C1687723A303EB5','_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m0A312D00285BCEF66450D70CA652BA8321BAEA5F','_ReversePInvokeWrapper_ParallelForJobStruct_1_ProducerExecuteFn_Gen_m0A312D00285BCEF66450D70CA652BA8321BAEA5F','_JobChunk_Process_1_ProducerExecuteFn_Gen_mA53B53A85AC4346B8CEFE2823FBDA4C9DB78044F','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mA53B53A85AC4346B8CEFE2823FBDA4C9DB78044F','_JobChunk_Process_1_ProducerExecuteFn_Gen_m57CB65231DF8994DE71EB6934BEFB36186DC954D','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m57CB65231DF8994DE71EB6934BEFB36186DC954D','_JobChunk_Process_1_ProducerExecuteFn_Gen_mE9B9B4E7BB06318FE716A529DBAEA68F866AE740','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mE9B9B4E7BB06318FE716A529DBAEA68F866AE740','_JobChunk_Process_1_ProducerExecuteFn_Gen_mD3EE34ABEA095B29A04A1221AB32E0FC0DFE7186','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mD3EE34ABEA095B29A04A1221AB32E0FC0DFE7186','_JobStruct_1_ProducerExecuteFn_Gen_m05F2B6491AA85B78DF8D68B424FCEE6AB25A939A','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m05F2B6491AA85B78DF8D68B424FCEE6AB25A939A','_JobStruct_1_ProducerExecuteFn_Gen_m6CB571240CCB4C02C8CBF1FE9D707969946CC95F','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_m6CB571240CCB4C02C8CBF1FE9D707969946CC95F','_JobChunk_Process_1_ProducerExecuteFn_Gen_m55001EA32943F355019558C71283AF9A29A4C357','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m55001EA32943F355019558C71283AF9A29A4C357','_JobStruct_1_ProducerExecuteFn_Gen_mC121D74DCAA72DCBBA5D7E756FB4BCE30D4B625A','_ReversePInvokeWrapper_JobStruct_1_ProducerExecuteFn_Gen_mC121D74DCAA72DCBBA5D7E756FB4BCE30D4B625A','_JobChunk_Process_1_ProducerExecuteFn_Gen_m2EB96584C50B8EB4ED1FDD4D8D9732F944AE8272','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m2EB96584C50B8EB4ED1FDD4D8D9732F944AE8272','_JobChunk_Process_1_ProducerExecuteFn_Gen_m695C0E98BF219ED7D80FBF261CBB74C04B2A6137','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m695C0E98BF219ED7D80FBF261CBB74C04B2A6137','_JobChunk_Process_1_ProducerExecuteFn_Gen_mFC516F47DE9388EC152F60A7A6F4DC573DA7D912','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mFC516F47DE9388EC152F60A7A6F4DC573DA7D912','_JobChunk_Process_1_ProducerExecuteFn_Gen_mC3B8A2E5E332EAA88B5737AD0FDBE182C4369AEE','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mC3B8A2E5E332EAA88B5737AD0FDBE182C4369AEE','_JobChunk_Process_1_ProducerExecuteFn_Gen_m9A25B066FCE97D46108EA6E784AEAF1CE6EC1798','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_m9A25B066FCE97D46108EA6E784AEAF1CE6EC1798','_U3CU3Ec_U3COnUpdateU3Eb__6_0_mB99D688B53582FDEC2C36802EC454104055C4420','_U3CU3Ec__DisplayClass6_0_U3COnUpdateU3Eb__1_m7B972BFCCB4900CE5052B039E0F4066C28605FF2','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m91062E044ED0E6966C9DE2EF173BA0904BDEF5DE','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_mB408CC63D9C37D30E5A53EA6677A38E5CC853450','_UpdateLightMatricesSystem_U3COnUpdateU3Eb__0_0_m2E333E0AF243F78EBB124B1581B092DEDFD0C7B9','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__0_m68DA25CBF3A19624916F5795DDF9FEA75A4D7D7F','_JobChunk_Process_1_ProducerExecuteFn_Gen_mA61082BEA79B8F5AE866974BBB1764FF257751EF','_ReversePInvokeWrapper_JobChunk_Process_1_ProducerExecuteFn_Gen_mA61082BEA79B8F5AE866974BBB1764FF257751EF','_U3CU3Ec__DisplayClass7_0_U3COnUpdateU3Eb__0_m69465EA8081E657462A5E571D4B1026C1193F346','_GC_ignore_warn_proc','__ZN4bgfx2glL15stubPolygonModeEjj','__ZN4bgfx2glL23stubVertexAttribDivisorEjj','__ZN4bgfx2glL21stubInsertEventMarkerEiPKc','_emscripten_glVertexAttribDivisorANGLE','_emscripten_glAttachShader','_emscripten_glBindBuffer','_emscripten_glBindFramebuffer','_emscripten_glBindRenderbuffer','_emscripten_glBindTexture','_emscripten_glBlendEquationSeparate','_emscripten_glBlendFunc','_emscripten_glDeleteBuffers','_emscripten_glDeleteFramebuffers','_emscripten_glDeleteRenderbuffers','_emscripten_glDeleteTextures','_emscripten_glDetachShader','_emscripten_glGenBuffers','_emscripten_glGenFramebuffers','_emscripten_glGenRenderbuffers','_emscripten_glGenTextures','_emscripten_glGetBooleanv','_emscripten_glGetFloatv','_emscripten_glGetIntegerv','_emscripten_glHint','_emscripten_glPixelStorei','_emscripten_glStencilMaskSeparate','_emscripten_glUniform1i','_emscripten_glVertexAttrib1fv','_emscripten_glVertexAttrib2fv','_emscripten_glVertexAttrib3fv','_emscripten_glVertexAttrib4fv','_emscripten_glGenQueriesEXT','_emscripten_glDeleteQueriesEXT','_emscripten_glBeginQueryEXT','_emscripten_glQueryCounterEXT','_emscripten_glDeleteVertexArraysOES','_emscripten_glGenVertexArraysOES','_emscripten_glDrawBuffersWEBGL','_emscripten_glGenQueries','_emscripten_glDeleteQueries','_emscripten_glBeginQuery','_emscripten_glDrawBuffers','_emscripten_glDeleteVertexArrays','_emscripten_glGenVertexArrays','_emscripten_glVertexAttribI4iv','_emscripten_glVertexAttribI4uiv','_emscripten_glUniform1ui','_emscripten_glGetInteger64v','_emscripten_glGenSamplers','_emscripten_glDeleteSamplers','_emscripten_glBindSampler','_emscripten_glVertexAttribDivisor','_emscripten_glBindTransformFeedback','_emscripten_glDeleteTransformFeedbacks','_emscripten_glGenTransformFeedbacks','_emscripten_glVertexAttribDivisorNV','_emscripten_glVertexAttribDivisorEXT','_emscripten_glVertexAttribDivisorARB','_emscripten_glDrawBuffersEXT',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_viif = [0,'_emscripten_glTexParameterf$legalf32','_emscripten_glSamplerParameterf$legalf32',0];
var debug_table_viifi = [0,'_emscripten_glClearBufferfi$legalf32'];
var debug_table_viii = [0,'_ManagedJobForEachDelegate_Invoke_m3AC993F0DAE9EE461BB43E8EBC03138ACCDE003F','_ManagedJobMarshalDelegate_Invoke_m3C969D391C113846AA5178E4008EA3E5030B9C17','_MemoryBinaryReader_ReadBytes_mC92A1A4EE6BB0D6AB0A68D554B53DF00DC8B8E24','_vii_Invoke_m533C8270BF8EB30DAB74CFEDD6E8C316C2259BC4','_F_ED_1_Invoke_mBDB74D7D72B2EC00B713400F0B2AA38EFE20DA2F','_RetainBlobAssetSystem_OnUpdate_m66C5C4CAC1C15CA6A1648783B9375708F8C8E6EE','_ParentSystem_OnUpdate_mC874FA62BE1C461FB438738F5308C74235376EAE','_CompositeScaleSystem_OnUpdate_m8FB9DE0C4A803A39C8AE77FA46E6B466416FD595','_RotationEulerSystem_OnUpdate_m54010EF7BBD4CFA84987BEE0E975D2ECB1BCE782','_PostRotationEulerSystem_OnUpdate_mCA581312AA1EEAD981D0C3EB922D277561327409','_CompositeRotationSystem_OnUpdate_mAC4CAFA475A98011E2EF6848E295155DBBC67502','_TRSToLocalToWorldSystem_OnUpdate_m1BAF0945BD61477B3E4D7F050DD3B6E030C58EA5','_ParentScaleInverseSystem_OnUpdate_m111C043E44C3E150F19BF804991B69E75867FD60','_TRSToLocalToParentSystem_OnUpdate_m2B27D511140B53487172F3ECEC4D0D3A46627FD5','_LocalToParentSystem_OnUpdate_m2EA7CE654C3CB07B51748F8440210CA5E2D5F025','_WorldToLocalSystem_OnUpdate_m08B65F0DFE8351DBDD7EFADB4AB2F27E6DF16604','_SubmitSimpleLitMeshChunked_OnUpdate_mF99A9310604E0728F3A29C7509487D63B1543428','_Action_2_Invoke_mA77FB3C06D041862A25DA278D1C5B1D4BD4E2758','__ZN4bgfx2gl17RendererContextGL18createVertexLayoutENS_18VertexLayoutHandleERKNS_12VertexLayoutE','__ZN4bgfx2gl17RendererContextGL12createShaderENS_12ShaderHandleEPKNS_6MemoryE','__ZN4bgfx2gl17RendererContextGL16overrideInternalENS_13TextureHandleEm','__ZN4bgfx2gl17RendererContextGL17requestScreenShotENS_17FrameBufferHandleEPKc','__ZN4bgfx2gl17RendererContextGL14updateViewNameEtPKc','__ZN4bgfx2gl17RendererContextGL9setMarkerEPKct','__ZN4bgfx2gl17RendererContextGL10blitRenderERNS_19TextVideoMemBlitterEj','__ZN4bgfx4noop19RendererContextNOOP18createVertexLayoutENS_18VertexLayoutHandleERKNS_12VertexLayoutE','__ZN4bgfx4noop19RendererContextNOOP12createShaderENS_12ShaderHandleEPKNS_6MemoryE','__ZN4bgfx4noop19RendererContextNOOP16overrideInternalENS_13TextureHandleEm','__ZN4bgfx4noop19RendererContextNOOP17requestScreenShotENS_17FrameBufferHandleEPKc','__ZN4bgfx4noop19RendererContextNOOP14updateViewNameEtPKc','__ZN4bgfx4noop19RendererContextNOOP9setMarkerEPKct','__ZN4bgfx4noop19RendererContextNOOP10blitRenderERNS_19TextVideoMemBlitterEj','__ZN4bgfx12CallbackStub12captureFrameEPKvj','__ZN4bgfx11CallbackC9912captureFrameEPKvj','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_mAFDF6869017625FEE982D36B44895D7B727B1979','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_m8A881A243B61D6BEEF1F721B62C237919589D82F','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__1_m6AFBBA09FF87995493C532C34E7D4762F940BB67','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__2_m8E1BEE4AEF9F95AD709F3B17EA1EAFF5ABD16BC6','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__3_mE150762AB6558CEF7143CD9C3C279572E014BFEB','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__7_mE4CC8E3543E8B7D4EE113C7CCD66C14F1AAD649C','_U3CU3Ec__DisplayClass10_0_U3CBuildDefaultRenderGraphU3Eb__1_m2FE5BF59BEE79C40C56027ECD724D7AC28540A65','_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__0_mEE9A2757A52E504FC049B383CE3DEAEDBD22265A','_U3CU3Ec__DisplayClass43_0_U3CDestroyAllTexturesU3Eb__3_mF085F6A929C484CFBA3B7CF31F866BE92A4EB38C','_U3CU3Ec__DisplayClass44_0_U3CShutdownU3Eb__0_mCCBB38D05DF7F2AFC4F149AAC020F7257923AC3E','_U3CU3Ec__DisplayClass75_0_U3CUploadTexturesU3Eb__0_mFA2838749F289552F5D03E0F4E3B947B2F8E1A8E','_U3CU3Ec__DisplayClass68_0_U3CUploadMeshesU3Eb__0_m0F52A5106291A94D8FB807158E4543C684517BE1','_U3CU3Ec__DisplayClass68_0_U3CUploadMeshesU3Eb__1_m860ECFE3010DA77F726311C8D44A01C1DE676A7D','_U3CU3Ec__DisplayClass76_0_U3CUpdateRTTU3Eb__1_m150510C22F1A7B4EBE5865E72B0E9CFE5B901A40','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_m776C73440E442A1E63B17752A6302A00D7E1DA0E','_U3CU3Ec_U3COnUpdateU3Eb__3_6_mC1E0FCB1185243DE6BBC27D82D27B888661D2D7E','_StructuralChange_AddComponentEntitiesBatchExecute_mA9992EAFAB17A435D35C09B990AE5FAE52676A39','_StructuralChange_RemoveComponentEntitiesBatchExecute_m6632C5213792F71C74F594B1A5FE346C95533033','_StructuralChange_MoveEntityArchetypeExecute_m1FEF3D40A2CDF4B15AAF65BA953B04EADA5F5628','_U3CU3Ec__DisplayClass3_0_U3CInitializeSystemsU3Eb__0_m9719A5FE728EDE1FBF0C72105AC8544447F5CBED','_U3CU3Ec__DisplayClass3_0_U3CInitializeSystemsU3Eb__1_mF7CB925DD32BC2BD91BE2D76B4C5CB886FB40C07','_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob0_PerformLambda_m87BE33CFD398760E10F74AFEFE10EF352F280A46','_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob1_PerformLambda_mBE1855D34FA165EEBA9634C3F05A62C93A52382C','_U3CU3Ec__DisplayClass_OnUpdate_LambdaJob2_PerformLambda_m847B8710686A7AEBC61CECB1A7FC11F3475F04C2','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__3_mF2D2A80DD6A9FB20334D6AD06AFC04946F2E3A65','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__4_m95DCE9F3EB553ED48A7B657010C9860A5EDA8F25','__ZL13capture_frameP25bgfx_callback_interface_sPKvj','__ZN4bgfx2glL25stubInvalidateFramebufferEjiPKj','_emscripten_glBindAttribLocation','_emscripten_glDrawArrays','_emscripten_glGetBufferParameteriv','_emscripten_glGetProgramiv','_emscripten_glGetRenderbufferParameteriv','_emscripten_glGetShaderiv','_emscripten_glGetTexParameterfv','_emscripten_glGetTexParameteriv','_emscripten_glGetUniformfv','_emscripten_glGetUniformiv','_emscripten_glGetVertexAttribfv','_emscripten_glGetVertexAttribiv','_emscripten_glGetVertexAttribPointerv','_emscripten_glStencilFunc','_emscripten_glStencilOp','_emscripten_glTexParameterfv','_emscripten_glTexParameteri','_emscripten_glTexParameteriv','_emscripten_glUniform1fv','_emscripten_glUniform1iv','_emscripten_glUniform2fv','_emscripten_glUniform2i','_emscripten_glUniform2iv','_emscripten_glUniform3fv','_emscripten_glUniform3iv','_emscripten_glUniform4fv','_emscripten_glUniform4iv','_emscripten_glGetQueryivEXT','_emscripten_glGetQueryObjectivEXT','_emscripten_glGetQueryObjectuivEXT','_emscripten_glGetQueryObjecti64vEXT','_emscripten_glGetQueryObjectui64vEXT','_emscripten_glGetQueryiv','_emscripten_glGetQueryObjectuiv','_emscripten_glGetBufferPointerv','_emscripten_glFlushMappedBufferRange','_emscripten_glGetIntegeri_v','_emscripten_glBindBufferBase','_emscripten_glGetVertexAttribIiv','_emscripten_glGetVertexAttribIuiv','_emscripten_glGetUniformuiv','_emscripten_glUniform2ui','_emscripten_glUniform1uiv','_emscripten_glUniform2uiv','_emscripten_glUniform3uiv','_emscripten_glUniform4uiv','_emscripten_glClearBufferiv','_emscripten_glClearBufferuiv','_emscripten_glClearBufferfv','_emscripten_glUniformBlockBinding','_emscripten_glGetInteger64i_v','_emscripten_glGetBufferParameteri64v','_emscripten_glSamplerParameteri','_emscripten_glSamplerParameteriv','_emscripten_glSamplerParameterfv','_emscripten_glGetSamplerParameteriv','_emscripten_glGetSamplerParameterfv','_emscripten_glProgramParameteri','_emscripten_glInvalidateFramebuffer',0,0,0,0,0,0];
var debug_table_viiii = [0,'_Image2DIOHTMLLoader_FreeNative_m5CB30C270ADBBB068EEEFD32071A7ABAB9F58BCF','_F_DDD_3_Invoke_m18109753C8BAEB74FDE506232CB43B212F6B1777','_F_DDD_3_Invoke_m744541C2C04266510B610C5ED6132351C97C9BE3','_F_EDD_2_Invoke_m096B6BBB008DC0D70270C81E20D45D822C6F85B9','_PerformLambdaDelegate_Invoke_m98AA3543BF21BE985F4CC17C9DD5C1BF67E9C664','_AddComponentEntitiesBatchDelegate_Invoke_m81A8D5E64C1513E4056FDDA33E03C9FD746F8FBC','_RemoveComponentEntitiesBatchDelegate_Invoke_m1F4ACE6C740AAF68C33F3A01FF6C0AB4AFC94AEA','_MoveEntityArchetypeDelegate_Invoke_m871D0F6874B4B28CFF7E4DB27703E527E09BC7A0','_GatherComponentDataJob_1_Execute_mB81000375BA9E1867C5DDD3EADF12E2348A8591A_AdjustorThunk','_GatherEntitiesJob_Execute_mFB02F83EE5235B6ED4753C1E826AC5B14B4BDE69_AdjustorThunk','_SubmitSimpleLitMeshJob_Execute_m5CBC5774C0068E1593CA99850BEE95168FE170DB_AdjustorThunk','_BuildEntityGuidHashMapJob_Execute_m176DA17ACEF9AC0AAC258EB8431A0E1F943914F1_AdjustorThunk','_ToCompositeRotation_Execute_m2D54CF99DABBE5DD9614200125EF039A6604F2F4_AdjustorThunk','_ToCompositeScale_Execute_m002B6B5DEEF1837296598C74134E261A62BDCB4B_AdjustorThunk','_UpdateHierarchy_Execute_mED64DF77AFD4A2AC0D0B70E7B1D90384CA49DC74_AdjustorThunk','_ToChildParentScaleInverse_Execute_m8C1627A557AE21DE9B7E7523AFB14FA16294F9F5_AdjustorThunk','_GatherChangedParents_Execute_mFC220C1E9BAF3A74AE87331854B9892FAB12ADFB_AdjustorThunk','_PostRotationEulerToPostRotation_Execute_mC96EA04B5309C98D418D2941A80D6779DD0A6B31_AdjustorThunk','_RotationEulerToRotation_Execute_m4DA8C0204AC1B32523C931D8B86470D5E6B5EA5E_AdjustorThunk','_TRSToLocalToParent_Execute_m185A564D77B1131331065663330F199074D0718B_AdjustorThunk','_TRSToLocalToWorld_Execute_mD3A5E2DECDE932BB8B1C3FECD3F6928B896D9C93_AdjustorThunk','_ToWorldToLocal_Execute_m6F5BBD2C72D7E3E369AF7D0CFA85514BEFC06E52_AdjustorThunk','__ZN4bgfx2gl17RendererContextGL17createIndexBufferENS_17IndexBufferHandleEPKNS_6MemoryEt','__ZN4bgfx2gl17RendererContextGL24createDynamicIndexBufferENS_17IndexBufferHandleEjt','__ZN4bgfx2gl17RendererContextGL25createDynamicVertexBufferENS_18VertexBufferHandleEjt','__ZN4bgfx2gl17RendererContextGL13createProgramENS_13ProgramHandleENS_12ShaderHandleES3_','__ZN4bgfx2gl17RendererContextGL18updateTextureBeginENS_13TextureHandleEhh','__ZN4bgfx2gl17RendererContextGL11readTextureENS_13TextureHandleEPvh','__ZN4bgfx2gl17RendererContextGL17createFrameBufferENS_17FrameBufferHandleEhPKNS_10AttachmentE','__ZN4bgfx2gl17RendererContextGL13updateUniformEtPKvj','__ZN4bgfx2gl17RendererContextGL7setNameENS_6HandleEPKct','__ZN4bgfx2gl17RendererContextGL6submitEPNS_5FrameERNS_9ClearQuadERNS_19TextVideoMemBlitterE','__ZN4bgfx4noop19RendererContextNOOP17createIndexBufferENS_17IndexBufferHandleEPKNS_6MemoryEt','__ZN4bgfx4noop19RendererContextNOOP24createDynamicIndexBufferENS_17IndexBufferHandleEjt','__ZN4bgfx4noop19RendererContextNOOP25createDynamicVertexBufferENS_18VertexBufferHandleEjt','__ZN4bgfx4noop19RendererContextNOOP13createProgramENS_13ProgramHandleENS_12ShaderHandleES3_','__ZN4bgfx4noop19RendererContextNOOP18updateTextureBeginENS_13TextureHandleEhh','__ZN4bgfx4noop19RendererContextNOOP11readTextureENS_13TextureHandleEPvh','__ZN4bgfx4noop19RendererContextNOOP17createFrameBufferENS_17FrameBufferHandleEhPKNS_10AttachmentE','__ZN4bgfx4noop19RendererContextNOOP13updateUniformEtPKvj','__ZN4bgfx4noop19RendererContextNOOP7setNameENS_6HandleEPKct','__ZN4bgfx4noop19RendererContextNOOP6submitEPNS_5FrameERNS_9ClearQuadERNS_19TextVideoMemBlitterE','__ZNK10__cxxabiv117__class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi','__ZNK10__cxxabiv120__si_class_type_info27has_unambiguous_public_baseEPNS_19__dynamic_cast_infoEPvi','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__0_mF863D8FFFDD5DAB07A3D02D7A935F4996EE792BF','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__4_mB12BD304A1A5DE24317695F1F5B56AE9BD55A083','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__5_m6D700A723DC5E3A6DA74ADE48F87E9092CFF6B7C','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__6_mC4892AD24A0B24A87F7054140C9A6972E8AEB999','_U3CU3Ec__DisplayClass15_0_U3CBuildAllLightNodesU3Eb__0_m8A3BAA16A25B86E9BC34A188739978492C1B6BE9','_U3CU3Ec_U3CUpdateExternalTexturesU3Eb__71_0_mC2805D91566527A40C7DB0B2D92BF4D32045CE6B','_U3CU3Ec__DisplayClass75_0_U3CUploadTexturesU3Eb__1_m13967E8BD0B565CB9F607394C54081777587BCAB','_U3CU3Ec__DisplayClass76_0_U3CUpdateRTTU3Eb__0_m0D2833BF6CAD584DD364E8D1890F821711C87F5D','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__3_m0B5A98632248345184B9E76C37581817D7361713','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__9_m0A90FA1A93A9AF07CBA61739413ECFC685D6C80E','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__1_mFB656D4D666B75268C34A480A954D0356FBBCA5C','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__2_m20CEF4A43E3C8A76A394F843BECB40A5518DBC69','_U3CU3Ec__DisplayClass5_0_U3COnUpdateU3Eb__3_mF7A5234B57925D66BC1912AC5A0A1A1F28F298C3','_StructuralChange_AddComponentChunksExecute_m93FADB4248E9D744F87C5BA0A92F6D85F9C87720','_StructuralChange_RemoveComponentChunksExecute_m884C1F67D3E5366A235EFFF73BECAD43451251AE','_StructuralChange_CreateEntityExecute_m004B3E705017E2710FF182143178D852D16D08AB','_StructuralChange_InstantiateEntitiesExecute_mCC1E269F8C1720814E7F240E61D755E9E7B4AE5F','_U3CU3Ec_U3COnUpdateU3Eb__2_2_m2C840F9F1F90A592E73CC3D3A4B8E860D7158E17','_U3CU3Ec_U3COnUpdateU3Eb__0_3_mAF3184BC24DFB7D0AB08ED9B2043E0E9E97ED6C2','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__1_m59B22C492C60292E735962F08871546F6C33EACC','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__2_m5342CF951FEFD87353938E25B05FDBD21B4164D8','__ZN4bgfx2glL27stubMultiDrawArraysIndirectEjPKvii','__ZN4bgfx2glL23stubDrawArraysInstancedEjiii','__ZN4bgfx2glL18stubPushDebugGroupEjjiPKc','__ZN4bgfx2glL15stubObjectLabelEjjiPKc','_emscripten_glBlendFuncSeparate','_emscripten_glBufferData','_emscripten_glBufferSubData','_emscripten_glColorMask','_emscripten_glDrawElements','_emscripten_glFramebufferRenderbuffer','_emscripten_glGetAttachedShaders','_emscripten_glGetFramebufferAttachmentParameteriv','_emscripten_glGetProgramInfoLog','_emscripten_glGetShaderInfoLog','_emscripten_glGetShaderPrecisionFormat','_emscripten_glGetShaderSource','_emscripten_glRenderbufferStorage','_emscripten_glScissor','_emscripten_glShaderSource','_emscripten_glStencilFuncSeparate','_emscripten_glStencilOpSeparate','_emscripten_glUniform3i','_emscripten_glUniformMatrix2fv','_emscripten_glUniformMatrix3fv','_emscripten_glUniformMatrix4fv','_emscripten_glViewport','_emscripten_glDrawArraysInstancedANGLE','_emscripten_glUniformMatrix2x3fv','_emscripten_glUniformMatrix3x2fv','_emscripten_glUniformMatrix2x4fv','_emscripten_glUniformMatrix4x2fv','_emscripten_glUniformMatrix3x4fv','_emscripten_glUniformMatrix4x3fv','_emscripten_glTransformFeedbackVaryings','_emscripten_glUniform3ui','_emscripten_glGetUniformIndices','_emscripten_glGetActiveUniformBlockiv','_emscripten_glDrawArraysInstanced','_emscripten_glProgramBinary','_emscripten_glDrawArraysInstancedNV','_emscripten_glDrawArraysInstancedEXT','_emscripten_glDrawArraysInstancedARB',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_viiiii = [0,'_F_DDDD_4_Invoke_m4F0B22DF29BD4E93CB3AB469DB1F746DF0CC34AB','_F_DDDD_4_Invoke_m11BADF098402BA36B0CE4594C23641C318B805E0','_F_EDDD_3_Invoke_mA1BF9E99BB5BA06875887C8C540E72A391BAF212','_AddComponentChunksDelegate_Invoke_mEB39B42D8E8A764C07CF99AFA4F0E25F7E9832D3','_RemoveComponentChunksDelegate_Invoke_m2D471B50C0243AC46440B324DBBF3897D967D068','_CreateEntityDelegate_Invoke_m350507B1E9396D0E97C268DD5D3658D1C9CE5A31','_InstantiateEntitiesDelegate_Invoke_mBEA19C2146BAE848974391288BA3B44F83A2006B','__ZN4bgfx2gl17RendererContextGL18createVertexBufferENS_18VertexBufferHandleEPKNS_6MemoryENS_18VertexLayoutHandleEt','__ZN4bgfx2gl17RendererContextGL24updateDynamicIndexBufferENS_17IndexBufferHandleEjjPKNS_6MemoryE','__ZN4bgfx2gl17RendererContextGL25updateDynamicVertexBufferENS_18VertexBufferHandleEjjPKNS_6MemoryE','__ZN4bgfx2gl17RendererContextGL13createUniformENS_13UniformHandleENS_11UniformType4EnumEtPKc','__ZN4bgfx4noop19RendererContextNOOP18createVertexBufferENS_18VertexBufferHandleEPKNS_6MemoryENS_18VertexLayoutHandleEt','__ZN4bgfx4noop19RendererContextNOOP24updateDynamicIndexBufferENS_17IndexBufferHandleEjjPKNS_6MemoryE','__ZN4bgfx4noop19RendererContextNOOP25updateDynamicVertexBufferENS_18VertexBufferHandleEjjPKNS_6MemoryE','__ZN4bgfx4noop19RendererContextNOOP13createUniformENS_13UniformHandleENS_11UniformType4EnumEtPKc','__ZN4bgfx12CallbackStub5fatalEPKctNS_5Fatal4EnumES2_','__ZN4bgfx12CallbackStub10traceVargsEPKctS2_Pi','__ZN4bgfx12CallbackStub13profilerBeginEPKcjS2_t','__ZN4bgfx12CallbackStub20profilerBeginLiteralEPKcjS2_t','__ZN4bgfx11CallbackC995fatalEPKctNS_5Fatal4EnumES2_','__ZN4bgfx11CallbackC9910traceVargsEPKctS2_Pi','__ZN4bgfx11CallbackC9913profilerBeginEPKcjS2_t','__ZN4bgfx11CallbackC9920profilerBeginLiteralEPKcjS2_t','__ZNK10__cxxabiv117__class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib','__ZNK10__cxxabiv120__si_class_type_info16search_below_dstEPNS_19__dynamic_cast_infoEPKvib','_JobChunk_Process_1_Execute_m4A73F32C697B84B67082337028F3A2D2B671D1B3','_JobChunk_Process_1_Execute_m344686467758104F759DF9BED499751306D717B3','_JobChunk_Process_1_Execute_m5919E1D4CA2DF21D82D32DF41C11F152FF8DA31B','_JobChunk_Process_1_Execute_mF70EE92049835D43111C0B31C4BCB8B080B0B874','_JobChunk_Process_1_Execute_m743596149E78AB1B52DE75E90862712FEFBD6215','_JobChunk_Process_1_Execute_mD18A4EE031E67D4A34E00DE3571A54434C5AC8E7','_JobChunk_Process_1_Execute_mF99D25A54008ADFAB1E7802810F1AF39947136D2','_JobChunk_Process_1_Execute_m0560FAA51B8638B6ECE0CE082011233B7127E0EA','_JobChunk_Process_1_Execute_mCC21934E24BACDC0BF391812BB39B774511AD7E1','_JobChunk_Process_1_Execute_mA6CABDD0E2DF88C91E6730BA4B42EC58FEC0EAC1','_JobChunk_Process_1_Execute_mCECA0926C8F5A419E5DB7E273AAA9CCA95EF880F','_JobChunk_Process_1_Execute_m4C44B1FF067388320F15EB36BD4255716B555E2E','_JobChunk_Process_1_Execute_mFDEF8359EAB8C5726A83A9965CF6D4D390B279A5','_JobChunk_Process_1_Execute_mE7367FF6621EBC0C557A0BD140F2D4B4E4F65B0D','_JobStruct_1_Execute_m094BCB27AF4F2133D1B714E8A38B5F327BE9706E','_JobStruct_1_Execute_mF89796E2479545F529F8F3F167F06D9F413A0719','_JobStruct_1_Execute_m6F3E63518FCD4FCC1D65EA12380E70EEE44F2E20','_JobStruct_1_Execute_mC9BC541911E3E51C0D6AB4E96636525446F60AF9','_JobStruct_1_Execute_m28CDC41FC72CDFFBA94813555E0B2ED2BC174A99','_JobStruct_1_Execute_m50F43675D3EC200E12A6C53581C0680437CEF2D1','_JobStruct_1_Execute_m0B608812CED51496191EB174724B09F2F2797576','_JobStruct_1_Execute_mDE624494B22F45A6A7A35230C5129A70583063EF','_JobStruct_1_Execute_mF0E84DB5CF668F3C7E2FD27C158893F649DFFDAE','_JobStruct_1_Execute_m703EA86B136DFD829F2AC336157E970D838147F4','_JobStruct_1_Execute_m98175360E98E5BF576F5627896ADDF42B3DA1EE5','_ParallelForJobStruct_1_Execute_mA786DB94088190D3ACA2E2DE41B1C7F98FE0383C','_ParallelForJobStruct_1_Execute_m689A5D20674BC4F2233D36AAF10F06F4FC2C8197','_ParallelForJobStruct_1_Execute_m6CC1DF5D68641FD8998D84D4DA73B28365898491','_ParallelForJobStruct_1_Execute_m3F0D48A24202C4291C38F0CE43A33ABA883D892B','_ParallelForJobStruct_1_Execute_mACA8149198388810205EFA018ABDF65EC28A0C68','_ParallelForJobStruct_1_Execute_mAECB2FEDB8B1D50134252D669E092AD3610CE5A7','_ParallelForJobStruct_1_Execute_mD755D54D28940CBD560CBF3FC206E8483D937C2F','_ParallelForJobStruct_1_Execute_m5D76A1D45233AEDA8FB5413FE0CBF8259DBD482E','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__2_m655BBA6342A4F415B2509502444AD86246FFC073','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__1_mE7C48923AE16B18B62C2B1F2C840715ED97CBDB4','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__2_m39AF8F63A133967A62A68A72EDA82C4CC5BF1FA6','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__4_m370B955F696FA009D98E6311F92C341B3481DBEC','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__7_m7C23D96A6A2A0B46A601CB1C3E649BEFACDDFAFC','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__8_mB60AC2E6F178F794F0D7ADAA22FA7A5BC3C14D59','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__3_m667AD03E903DDBF143756C3EE09D1B2791684E79','_StructuralChange_AddSharedComponentChunksExecute_mDE42CA5BEB4AA2BD8D338F87AAE78260366C4C69','_StructuralChange_SetChunkComponentExecute_m2C93664388AEC82B9530D7B83D4A5D30BA04AB90','_UpdateCameraZFarSystem_U3COnUpdateU3Eb__1_0_m8E695A280836141D3F9F78C4A76AE7F5AFAF0BAE','_U3CU3Ec_U3COnUpdateU3Eb__0_1_m0AB6657E2D66EC532E8166E79D9999FCB334EEA4','_U3CU3Ec_U3COnUpdateU3Eb__0_2_mB51247A4AE3D9CE066DCF197F987F5A7F44749DA','_U3CU3Ec__DisplayClass1_0_U3COnUpdateU3Eb__5_mD80F74215A91BC213E166CD0C4A655817DCC6E11','_U3CU3Ec_U3COnUpdateU3Eb__1_6_mFE1040400AB011EED5465A76205F242171FF2FFF','__ZL5fatalP25bgfx_callback_interface_sPKct10bgfx_fatalS2_','__ZL11trace_vargsP25bgfx_callback_interface_sPKctS2_Pi','__ZL14profiler_beginP25bgfx_callback_interface_sPKcjS2_t','__ZL22profiler_begin_literalP25bgfx_callback_interface_sPKcjS2_t','__ZN4bgfx2glL29stubMultiDrawElementsIndirectEjjPKvii','__ZN4bgfx2glL25stubDrawElementsInstancedEjijPKvi','_emscripten_glFramebufferTexture2D','_emscripten_glShaderBinary','_emscripten_glUniform4i','_emscripten_glDrawElementsInstancedANGLE','_emscripten_glRenderbufferStorageMultisample','_emscripten_glFramebufferTextureLayer','_emscripten_glBindBufferRange','_emscripten_glVertexAttribIPointer','_emscripten_glVertexAttribI4i','_emscripten_glVertexAttribI4ui','_emscripten_glUniform4ui','_emscripten_glCopyBufferSubData','_emscripten_glGetActiveUniformsiv','_emscripten_glGetActiveUniformBlockName','_emscripten_glDrawElementsInstanced','_emscripten_glGetSynciv','_emscripten_glGetProgramBinary','_emscripten_glTexStorage2D','_emscripten_glGetInternalformativ','_emscripten_glDrawElementsInstancedNV','_emscripten_glDrawElementsInstancedEXT','_emscripten_glDrawElementsInstancedARB',0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
var debug_table_viiiiii = [0,'_AddSharedComponentChunksDelegate_Invoke_m69D258DA9173E9C6C810047D548EAF5F3EE57867','_SetChunkComponentDelegate_Invoke_m6628766D30D9BD728BDDC92E544F7760E4671C29','_ExecuteJobFunction_Invoke_mE219201F3DEDE75C0E55BDC9411CE66C2C4BC9C8','_ExecuteJobFunction_Invoke_m9B5EA758280DF49BE9054F82A0A429071CCACC6A','_ExecuteJobFunction_Invoke_m8EA2634CD7700743BC8D329A0462F60B72579B87','_ExecuteJobFunction_Invoke_mEFAAFA54CC75A71828B84212900BFCE774E8BB9D','_ExecuteJobFunction_Invoke_m33CD9B920D0DA58CD2CEC9C5886E189A4B4AFFDB','_ExecuteJobFunction_Invoke_m099A240AC35E7A3610FDEB72EB5D25493602CF06','_ExecuteJobFunction_Invoke_m7B0AEE1297B002C6731CC1DBAE42DE92F1AF89C3','_ExecuteJobFunction_Invoke_m34EBCD69F8E5B014FE6E411718EFF40BAAFEC14C','_ExecuteJobFunction_Invoke_mC3148DCB2BC058F7BB0F80EBBA38BCF9BBF06B6E','_ExecuteJobFunction_Invoke_mCB961234C99EA1AFF8B55A8EF5F895813CB263BD','_ExecuteJobFunction_Invoke_m0F7F758C8C2A5885C4980EB8F00A66910BC9A26C','_ExecuteJobFunction_Invoke_mD4A1B83D2B0647D6FE3C92B4C69C3AC6FDE8C5DD','_ExecuteJobFunction_Invoke_mE217DCAD04653D1C477D656BD4C444297821DF34','_ExecuteJobFunction_Invoke_mB7B2CB6882D4EDB5720C77B81118F0A4BA0151A7','_ExecuteJobFunction_Invoke_m4677E63BAD1E9DC0BD841A3EE227AA43289CE56F','_ExecuteJobFunction_Invoke_m993FF816F6F36151DB90D109CF097312D861D284','_ExecuteJobFunction_Invoke_m993971ECFDA6A7A203CE6D4A246BBE7474212F25','_ExecuteJobFunction_Invoke_m6C575A23210159A227BCBBEDFA74F0FF8E19E4CE','_ExecuteJobFunction_Invoke_mB42EED7CEF37745D1F62A8E462A406CB55AAACC3','_ExecuteJobFunction_Invoke_m4D6751B072D0597CFAE4A660F5404D4778E4BC48','_ExecuteJobFunction_Invoke_m09D8050BB3700239DF338EBF020E547DF3B8A86B','_ExecuteJobFunction_Invoke_m75114CC4516FD6A24248701ABC155E37A1A80F0D','_ExecuteJobFunction_Invoke_mA55F8668A1B4BF219E7C7C64710020E7D046A83C','_ExecuteJobFunction_Invoke_m1CC2B4BBABDC10A656B2ACE783C90527CED03D20','_ExecuteJobFunction_Invoke_m3AD61D7AEE48786C4A68F04FE526541916DEADC6','_ExecuteJobFunction_Invoke_m7BDF98A9BEA57FE4F71725F79AF1E45A487BCCF2','_ExecuteJobFunction_Invoke_mCCD29FA0BB26187B504E6BB4C4B359A5880C6707','_ExecuteJobFunction_Invoke_m53313EB863B88799C6BDFE75318936387CDD99CA','_ExecuteJobFunction_Invoke_m50C23415803833A61CAE885971C5906671F55598','_ExecuteJobFunction_Invoke_m143BE4B20E0F76082CA6625FC5A43172424FE50D','_ExecuteJobFunction_Invoke_mB6B43ABB41086A16BE0BF75654B656A4A322E46C','_ExecuteJobFunction_Invoke_mA0102CA540749DACE5E8586BB041A835F203969B','_ExecuteJobFunction_Invoke_mC64F78335F9ADC11DB35222E5E69E02D47D1738C','_ExecuteJobFunction_Invoke_m608BEF85392FC1F78F831CA905E352916EADE003','_ExecuteJobFunction_Invoke_m80AFC9E7A51104224CF5FFB224120DD1D4F6BA2E','_ExecuteJobFunction_Invoke_m4D5D3C7B321F1BFAAB76E7A89F0BAD396940C9A1','__ZN4bgfx2gl17RendererContextGL13resizeTextureENS_13TextureHandleEttht','__ZN4bgfx4noop19RendererContextNOOP13resizeTextureENS_13TextureHandleEttht','__ZN4bgfx12CallbackStub12captureBeginEjjjNS_13TextureFormat4EnumEb','__ZN4bgfx11CallbackC9912captureBeginEjjjNS_13TextureFormat4EnumEb','__ZNK10__cxxabiv117__class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib','__ZNK10__cxxabiv120__si_class_type_info16search_above_dstEPNS_19__dynamic_cast_infoEPKvS4_ib','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__3_m29B3F1A1852E3089A472B368A8870F4EAE81E765','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__0_m7997E3CC6E80BB29EC3652D8AC4E39FD0CA790B4','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__5_m0DAA23B702DAD721397FE6179176BC3239733AA0','_U3CU3Ec__DisplayClass2_0_U3COnUpdateU3Eb__6_mA02CF64BB5029D16FDE19B9A996C415F2253C3E5','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__2_m2B1AE05419F90A5E1FFB30DE5E956B88BBA99AFD','__ZL13capture_beginP25bgfx_callback_interface_sjjj19bgfx_texture_formatb','_emscripten_glVertexAttribPointer','_emscripten_glDrawRangeElements','_emscripten_glTexStorage3D',0,0,0,0,0,0,0,0,0,0];
var debug_table_viiiiiii = [0,'_Image2DIOHTMLLoader_StartLoad_m2AA96C68AB0A9EC323F9324A270B5D16F9145B9E','__ZN4bgfx2gl17RendererContextGL17createFrameBufferENS_17FrameBufferHandleEPvjjNS_13TextureFormat4EnumES5_','__ZN4bgfx4noop19RendererContextNOOP17createFrameBufferENS_17FrameBufferHandleEPvjjNS_13TextureFormat4EnumES5_','_U3CU3Ec__DisplayClass0_0_U3COnUpdateU3Eb__0_mF357A248E8A2A39BF4832337A4D7AF2922F3117D','_SendMessageHandler_OnSendMessage_m5ABCD9BF9AC11BEC3D9421A7BCB8B56D7069CE55','_ReversePInvokeWrapper_SendMessageHandler_OnSendMessage_m5ABCD9BF9AC11BEC3D9421A7BCB8B56D7069CE55','__ZN4bgfx2gl11debugProcCbEjjjjiPKcPKv','_emscripten_glGetActiveAttrib','_emscripten_glGetActiveUniform','_emscripten_glReadPixels','_emscripten_glGetTransformFeedbackVarying','_emscripten_glInvalidateSubFramebuffer',0,0,0];
var debug_table_viiiiiiii = [0,'_RegisterSendMessageDelegate_Invoke_m3D20C4DCE61F24BC16D6CFB014D0A86841CC8769','__ZN4bgfx12CallbackStub10screenShotEPKcjjjPKvjb','__ZN4bgfx11CallbackC9910screenShotEPKcjjjPKvjb','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__4_m179472E0CF9A535F6A558BB2570C4B0155535F5C','_U3CU3Ec__DisplayClass3_0_U3COnUpdateU3Eb__5_mF71ADC34BD86C92E66C12B61E9240BA9EB910687','_U3CU3Ec__DisplayClass6_0_U3COnUpdateU3Eb__2_mEE344F96E4FCB16F0076961F35B1AE868AD7403D','__ZL11screen_shotP25bgfx_callback_interface_sPKcjjjPKvjb','_emscripten_glCompressedTexImage2D','_emscripten_glCopyTexImage2D','_emscripten_glCopyTexSubImage2D',0,0,0,0,0];
var debug_table_viiiiiiiii = [0,'__ZN4bgfx2gl17RendererContextGL13updateTextureENS_13TextureHandleEhhRKNS_4RectEtttPKNS_6MemoryE','__ZN4bgfx4noop19RendererContextNOOP13updateTextureENS_13TextureHandleEhhRKNS_4RectEtttPKNS_6MemoryE','_emscripten_glCompressedTexSubImage2D','_emscripten_glTexImage2D','_emscripten_glTexSubImage2D','_emscripten_glCopyTexSubImage3D','_emscripten_glCompressedTexImage3D'];
var debug_table_viiiiiiiiii = [0,'_emscripten_glTexImage3D','_emscripten_glBlitFramebuffer',0];
var debug_table_viiiiiiiiiii = [0,'_emscripten_glTexSubImage3D','_emscripten_glCompressedTexSubImage3D',0];
var debug_table_viiiiiiiiiiiiiii = [0];
var debug_table_viij = [0,'_emscripten_glWaitSync'];
var debug_table_vijii = [0,'__ZN4bgfx12CallbackStub10cacheWriteEyPKvj','__ZN4bgfx11CallbackC9910cacheWriteEyPKvj','__ZL11cache_writeP25bgfx_callback_interface_syPKvj'];
var debug_tables = {
  'fi': debug_table_fi,
  'i': debug_table_i,
  'idi': debug_table_idi,
  'ii': debug_table_ii,
  'iid': debug_table_iid,
  'iif': debug_table_iif,
  'iii': debug_table_iii,
  'iiii': debug_table_iiii,
  'iiiii': debug_table_iiiii,
  'iiiiiii': debug_table_iiiiiii,
  'iiiiiiiii': debug_table_iiiiiiiii,
  'iiiiiiiiiiiii': debug_table_iiiiiiiiiiiii,
  'iiiiiiiiiiiiii': debug_table_iiiiiiiiiiiiii,
  'iiiiji': debug_table_iiiiji,
  'iiij': debug_table_iiij,
  'iij': debug_table_iij,
  'iijii': debug_table_iijii,
  'ji': debug_table_ji,
  'jiji': debug_table_jiji,
  'v': debug_table_v,
  'vf': debug_table_vf,
  'vff': debug_table_vff,
  'vffff': debug_table_vffff,
  'vfi': debug_table_vfi,
  'vi': debug_table_vi,
  'vif': debug_table_vif,
  'viff': debug_table_viff,
  'vifff': debug_table_vifff,
  'viffff': debug_table_viffff,
  'vii': debug_table_vii,
  'viif': debug_table_viif,
  'viifi': debug_table_viifi,
  'viii': debug_table_viii,
  'viiii': debug_table_viiii,
  'viiiii': debug_table_viiiii,
  'viiiiii': debug_table_viiiiii,
  'viiiiiii': debug_table_viiiiiii,
  'viiiiiiii': debug_table_viiiiiiii,
  'viiiiiiiii': debug_table_viiiiiiiii,
  'viiiiiiiiii': debug_table_viiiiiiiiii,
  'viiiiiiiiiii': debug_table_viiiiiiiiiii,
  'viiiiiiiiiiiiiii': debug_table_viiiiiiiiiiiiiii,
  'viij': debug_table_viij,
  'vijii': debug_table_vijii,
};
function nullFunc_fi(x) { abortFnPtrError(x, 'fi'); }
function nullFunc_i(x) { abortFnPtrError(x, 'i'); }
function nullFunc_idi(x) { abortFnPtrError(x, 'idi'); }
function nullFunc_ii(x) { abortFnPtrError(x, 'ii'); }
function nullFunc_iid(x) { abortFnPtrError(x, 'iid'); }
function nullFunc_iif(x) { abortFnPtrError(x, 'iif'); }
function nullFunc_iii(x) { abortFnPtrError(x, 'iii'); }
function nullFunc_iiii(x) { abortFnPtrError(x, 'iiii'); }
function nullFunc_iiiii(x) { abortFnPtrError(x, 'iiiii'); }
function nullFunc_iiiiiii(x) { abortFnPtrError(x, 'iiiiiii'); }
function nullFunc_iiiiiiiii(x) { abortFnPtrError(x, 'iiiiiiiii'); }
function nullFunc_iiiiiiiiiiiii(x) { abortFnPtrError(x, 'iiiiiiiiiiiii'); }
function nullFunc_iiiiiiiiiiiiii(x) { abortFnPtrError(x, 'iiiiiiiiiiiiii'); }
function nullFunc_iiiiji(x) { abortFnPtrError(x, 'iiiiji'); }
function nullFunc_iiij(x) { abortFnPtrError(x, 'iiij'); }
function nullFunc_iij(x) { abortFnPtrError(x, 'iij'); }
function nullFunc_iijii(x) { abortFnPtrError(x, 'iijii'); }
function nullFunc_ji(x) { abortFnPtrError(x, 'ji'); }
function nullFunc_jiji(x) { abortFnPtrError(x, 'jiji'); }
function nullFunc_v(x) { abortFnPtrError(x, 'v'); }
function nullFunc_vf(x) { abortFnPtrError(x, 'vf'); }
function nullFunc_vff(x) { abortFnPtrError(x, 'vff'); }
function nullFunc_vffff(x) { abortFnPtrError(x, 'vffff'); }
function nullFunc_vfi(x) { abortFnPtrError(x, 'vfi'); }
function nullFunc_vi(x) { abortFnPtrError(x, 'vi'); }
function nullFunc_vif(x) { abortFnPtrError(x, 'vif'); }
function nullFunc_viff(x) { abortFnPtrError(x, 'viff'); }
function nullFunc_vifff(x) { abortFnPtrError(x, 'vifff'); }
function nullFunc_viffff(x) { abortFnPtrError(x, 'viffff'); }
function nullFunc_vii(x) { abortFnPtrError(x, 'vii'); }
function nullFunc_viif(x) { abortFnPtrError(x, 'viif'); }
function nullFunc_viifi(x) { abortFnPtrError(x, 'viifi'); }
function nullFunc_viii(x) { abortFnPtrError(x, 'viii'); }
function nullFunc_viiii(x) { abortFnPtrError(x, 'viiii'); }
function nullFunc_viiiii(x) { abortFnPtrError(x, 'viiiii'); }
function nullFunc_viiiiii(x) { abortFnPtrError(x, 'viiiiii'); }
function nullFunc_viiiiiii(x) { abortFnPtrError(x, 'viiiiiii'); }
function nullFunc_viiiiiiii(x) { abortFnPtrError(x, 'viiiiiiii'); }
function nullFunc_viiiiiiiii(x) { abortFnPtrError(x, 'viiiiiiiii'); }
function nullFunc_viiiiiiiiii(x) { abortFnPtrError(x, 'viiiiiiiiii'); }
function nullFunc_viiiiiiiiiii(x) { abortFnPtrError(x, 'viiiiiiiiiii'); }
function nullFunc_viiiiiiiiiiiiiii(x) { abortFnPtrError(x, 'viiiiiiiiiiiiiii'); }
function nullFunc_viij(x) { abortFnPtrError(x, 'viij'); }
function nullFunc_vijii(x) { abortFnPtrError(x, 'vijii'); }

var asmGlobalArg = {}

var asmLibraryArg = {
  "abort": abort,
  "setTempRet0": setTempRet0,
  "getTempRet0": getTempRet0,
  "nullFunc_fi": nullFunc_fi,
  "nullFunc_i": nullFunc_i,
  "nullFunc_idi": nullFunc_idi,
  "nullFunc_ii": nullFunc_ii,
  "nullFunc_iid": nullFunc_iid,
  "nullFunc_iif": nullFunc_iif,
  "nullFunc_iii": nullFunc_iii,
  "nullFunc_iiii": nullFunc_iiii,
  "nullFunc_iiiii": nullFunc_iiiii,
  "nullFunc_iiiiiii": nullFunc_iiiiiii,
  "nullFunc_iiiiiiiii": nullFunc_iiiiiiiii,
  "nullFunc_iiiiiiiiiiiii": nullFunc_iiiiiiiiiiiii,
  "nullFunc_iiiiiiiiiiiiii": nullFunc_iiiiiiiiiiiiii,
  "nullFunc_iiiiji": nullFunc_iiiiji,
  "nullFunc_iiij": nullFunc_iiij,
  "nullFunc_iij": nullFunc_iij,
  "nullFunc_iijii": nullFunc_iijii,
  "nullFunc_ji": nullFunc_ji,
  "nullFunc_jiji": nullFunc_jiji,
  "nullFunc_v": nullFunc_v,
  "nullFunc_vf": nullFunc_vf,
  "nullFunc_vff": nullFunc_vff,
  "nullFunc_vffff": nullFunc_vffff,
  "nullFunc_vfi": nullFunc_vfi,
  "nullFunc_vi": nullFunc_vi,
  "nullFunc_vif": nullFunc_vif,
  "nullFunc_viff": nullFunc_viff,
  "nullFunc_vifff": nullFunc_vifff,
  "nullFunc_viffff": nullFunc_viffff,
  "nullFunc_vii": nullFunc_vii,
  "nullFunc_viif": nullFunc_viif,
  "nullFunc_viifi": nullFunc_viifi,
  "nullFunc_viii": nullFunc_viii,
  "nullFunc_viiii": nullFunc_viiii,
  "nullFunc_viiiii": nullFunc_viiiii,
  "nullFunc_viiiiii": nullFunc_viiiiii,
  "nullFunc_viiiiiii": nullFunc_viiiiiii,
  "nullFunc_viiiiiiii": nullFunc_viiiiiiii,
  "nullFunc_viiiiiiiii": nullFunc_viiiiiiiii,
  "nullFunc_viiiiiiiiii": nullFunc_viiiiiiiiii,
  "nullFunc_viiiiiiiiiii": nullFunc_viiiiiiiiiii,
  "nullFunc_viiiiiiiiiiiiiii": nullFunc_viiiiiiiiiiiiiii,
  "nullFunc_viij": nullFunc_viij,
  "nullFunc_vijii": nullFunc_vijii,
  "_ConnClose": _ConnClose,
  "_Init": _Init,
  "_InvokeCallback_v": _InvokeCallback_v,
  "_InvokeCallback_vi": _InvokeCallback_vi,
  "_InvokeCallback_vii": _InvokeCallback_vii,
  "_InvokeCallback_vs": _InvokeCallback_vs,
  "_Invoke_i": _Invoke_i,
  "_Invoke_s": _Invoke_s,
  "_Invoke_vs": _Invoke_vs,
  "_OpenPeer": _OpenPeer,
  "_Send": _Send,
  "___cxa_begin_catch": ___cxa_begin_catch,
  "___exception_addRef": ___exception_addRef,
  "___exception_deAdjust": ___exception_deAdjust,
  "___gxx_personality_v0": ___gxx_personality_v0,
  "___lock": ___lock,
  "___setErrNo": ___setErrNo,
  "___syscall140": ___syscall140,
  "___syscall145": ___syscall145,
  "___syscall146": ___syscall146,
  "___syscall221": ___syscall221,
  "___syscall4": ___syscall4,
  "___syscall5": ___syscall5,
  "___syscall54": ___syscall54,
  "___syscall6": ___syscall6,
  "___unlock": ___unlock,
  "__computeUnpackAlignedImageSize": __computeUnpackAlignedImageSize,
  "__emscripten_fetch_xhr": __emscripten_fetch_xhr,
  "__emscripten_get_fetch_work_queue": __emscripten_get_fetch_work_queue,
  "__emscripten_traverse_stack": __emscripten_traverse_stack,
  "__findCanvasEventTarget": __findCanvasEventTarget,
  "__findEventTarget": __findEventTarget,
  "__formatString": __formatString,
  "__glGenObject": __glGenObject,
  "__heapObjectForWebGLType": __heapObjectForWebGLType,
  "__maybeCStringToJsString": __maybeCStringToJsString,
  "__reallyNegative": __reallyNegative,
  "_abort": _abort,
  "_clock": _clock,
  "_emscripten_asm_const_i": _emscripten_asm_const_i,
  "_emscripten_get_callstack_js": _emscripten_get_callstack_js,
  "_emscripten_get_heap_size": _emscripten_get_heap_size,
  "_emscripten_get_now": _emscripten_get_now,
  "_emscripten_glActiveTexture": _emscripten_glActiveTexture,
  "_emscripten_glAttachShader": _emscripten_glAttachShader,
  "_emscripten_glBeginQuery": _emscripten_glBeginQuery,
  "_emscripten_glBeginQueryEXT": _emscripten_glBeginQueryEXT,
  "_emscripten_glBeginTransformFeedback": _emscripten_glBeginTransformFeedback,
  "_emscripten_glBindAttribLocation": _emscripten_glBindAttribLocation,
  "_emscripten_glBindBuffer": _emscripten_glBindBuffer,
  "_emscripten_glBindBufferBase": _emscripten_glBindBufferBase,
  "_emscripten_glBindBufferRange": _emscripten_glBindBufferRange,
  "_emscripten_glBindFramebuffer": _emscripten_glBindFramebuffer,
  "_emscripten_glBindRenderbuffer": _emscripten_glBindRenderbuffer,
  "_emscripten_glBindSampler": _emscripten_glBindSampler,
  "_emscripten_glBindTexture": _emscripten_glBindTexture,
  "_emscripten_glBindTransformFeedback": _emscripten_glBindTransformFeedback,
  "_emscripten_glBindVertexArray": _emscripten_glBindVertexArray,
  "_emscripten_glBindVertexArrayOES": _emscripten_glBindVertexArrayOES,
  "_emscripten_glBlendColor": _emscripten_glBlendColor,
  "_emscripten_glBlendEquation": _emscripten_glBlendEquation,
  "_emscripten_glBlendEquationSeparate": _emscripten_glBlendEquationSeparate,
  "_emscripten_glBlendFunc": _emscripten_glBlendFunc,
  "_emscripten_glBlendFuncSeparate": _emscripten_glBlendFuncSeparate,
  "_emscripten_glBlitFramebuffer": _emscripten_glBlitFramebuffer,
  "_emscripten_glBufferData": _emscripten_glBufferData,
  "_emscripten_glBufferSubData": _emscripten_glBufferSubData,
  "_emscripten_glCheckFramebufferStatus": _emscripten_glCheckFramebufferStatus,
  "_emscripten_glClear": _emscripten_glClear,
  "_emscripten_glClearBufferfi": _emscripten_glClearBufferfi,
  "_emscripten_glClearBufferfv": _emscripten_glClearBufferfv,
  "_emscripten_glClearBufferiv": _emscripten_glClearBufferiv,
  "_emscripten_glClearBufferuiv": _emscripten_glClearBufferuiv,
  "_emscripten_glClearColor": _emscripten_glClearColor,
  "_emscripten_glClearDepthf": _emscripten_glClearDepthf,
  "_emscripten_glClearStencil": _emscripten_glClearStencil,
  "_emscripten_glClientWaitSync": _emscripten_glClientWaitSync,
  "_emscripten_glColorMask": _emscripten_glColorMask,
  "_emscripten_glCompileShader": _emscripten_glCompileShader,
  "_emscripten_glCompressedTexImage2D": _emscripten_glCompressedTexImage2D,
  "_emscripten_glCompressedTexImage3D": _emscripten_glCompressedTexImage3D,
  "_emscripten_glCompressedTexSubImage2D": _emscripten_glCompressedTexSubImage2D,
  "_emscripten_glCompressedTexSubImage3D": _emscripten_glCompressedTexSubImage3D,
  "_emscripten_glCopyBufferSubData": _emscripten_glCopyBufferSubData,
  "_emscripten_glCopyTexImage2D": _emscripten_glCopyTexImage2D,
  "_emscripten_glCopyTexSubImage2D": _emscripten_glCopyTexSubImage2D,
  "_emscripten_glCopyTexSubImage3D": _emscripten_glCopyTexSubImage3D,
  "_emscripten_glCreateProgram": _emscripten_glCreateProgram,
  "_emscripten_glCreateShader": _emscripten_glCreateShader,
  "_emscripten_glCullFace": _emscripten_glCullFace,
  "_emscripten_glDeleteBuffers": _emscripten_glDeleteBuffers,
  "_emscripten_glDeleteFramebuffers": _emscripten_glDeleteFramebuffers,
  "_emscripten_glDeleteProgram": _emscripten_glDeleteProgram,
  "_emscripten_glDeleteQueries": _emscripten_glDeleteQueries,
  "_emscripten_glDeleteQueriesEXT": _emscripten_glDeleteQueriesEXT,
  "_emscripten_glDeleteRenderbuffers": _emscripten_glDeleteRenderbuffers,
  "_emscripten_glDeleteSamplers": _emscripten_glDeleteSamplers,
  "_emscripten_glDeleteShader": _emscripten_glDeleteShader,
  "_emscripten_glDeleteSync": _emscripten_glDeleteSync,
  "_emscripten_glDeleteTextures": _emscripten_glDeleteTextures,
  "_emscripten_glDeleteTransformFeedbacks": _emscripten_glDeleteTransformFeedbacks,
  "_emscripten_glDeleteVertexArrays": _emscripten_glDeleteVertexArrays,
  "_emscripten_glDeleteVertexArraysOES": _emscripten_glDeleteVertexArraysOES,
  "_emscripten_glDepthFunc": _emscripten_glDepthFunc,
  "_emscripten_glDepthMask": _emscripten_glDepthMask,
  "_emscripten_glDepthRangef": _emscripten_glDepthRangef,
  "_emscripten_glDetachShader": _emscripten_glDetachShader,
  "_emscripten_glDisable": _emscripten_glDisable,
  "_emscripten_glDisableVertexAttribArray": _emscripten_glDisableVertexAttribArray,
  "_emscripten_glDrawArrays": _emscripten_glDrawArrays,
  "_emscripten_glDrawArraysInstanced": _emscripten_glDrawArraysInstanced,
  "_emscripten_glDrawArraysInstancedANGLE": _emscripten_glDrawArraysInstancedANGLE,
  "_emscripten_glDrawArraysInstancedARB": _emscripten_glDrawArraysInstancedARB,
  "_emscripten_glDrawArraysInstancedEXT": _emscripten_glDrawArraysInstancedEXT,
  "_emscripten_glDrawArraysInstancedNV": _emscripten_glDrawArraysInstancedNV,
  "_emscripten_glDrawBuffers": _emscripten_glDrawBuffers,
  "_emscripten_glDrawBuffersEXT": _emscripten_glDrawBuffersEXT,
  "_emscripten_glDrawBuffersWEBGL": _emscripten_glDrawBuffersWEBGL,
  "_emscripten_glDrawElements": _emscripten_glDrawElements,
  "_emscripten_glDrawElementsInstanced": _emscripten_glDrawElementsInstanced,
  "_emscripten_glDrawElementsInstancedANGLE": _emscripten_glDrawElementsInstancedANGLE,
  "_emscripten_glDrawElementsInstancedARB": _emscripten_glDrawElementsInstancedARB,
  "_emscripten_glDrawElementsInstancedEXT": _emscripten_glDrawElementsInstancedEXT,
  "_emscripten_glDrawElementsInstancedNV": _emscripten_glDrawElementsInstancedNV,
  "_emscripten_glDrawRangeElements": _emscripten_glDrawRangeElements,
  "_emscripten_glEnable": _emscripten_glEnable,
  "_emscripten_glEnableVertexAttribArray": _emscripten_glEnableVertexAttribArray,
  "_emscripten_glEndQuery": _emscripten_glEndQuery,
  "_emscripten_glEndQueryEXT": _emscripten_glEndQueryEXT,
  "_emscripten_glEndTransformFeedback": _emscripten_glEndTransformFeedback,
  "_emscripten_glFenceSync": _emscripten_glFenceSync,
  "_emscripten_glFinish": _emscripten_glFinish,
  "_emscripten_glFlush": _emscripten_glFlush,
  "_emscripten_glFlushMappedBufferRange": _emscripten_glFlushMappedBufferRange,
  "_emscripten_glFramebufferRenderbuffer": _emscripten_glFramebufferRenderbuffer,
  "_emscripten_glFramebufferTexture2D": _emscripten_glFramebufferTexture2D,
  "_emscripten_glFramebufferTextureLayer": _emscripten_glFramebufferTextureLayer,
  "_emscripten_glFrontFace": _emscripten_glFrontFace,
  "_emscripten_glGenBuffers": _emscripten_glGenBuffers,
  "_emscripten_glGenFramebuffers": _emscripten_glGenFramebuffers,
  "_emscripten_glGenQueries": _emscripten_glGenQueries,
  "_emscripten_glGenQueriesEXT": _emscripten_glGenQueriesEXT,
  "_emscripten_glGenRenderbuffers": _emscripten_glGenRenderbuffers,
  "_emscripten_glGenSamplers": _emscripten_glGenSamplers,
  "_emscripten_glGenTextures": _emscripten_glGenTextures,
  "_emscripten_glGenTransformFeedbacks": _emscripten_glGenTransformFeedbacks,
  "_emscripten_glGenVertexArrays": _emscripten_glGenVertexArrays,
  "_emscripten_glGenVertexArraysOES": _emscripten_glGenVertexArraysOES,
  "_emscripten_glGenerateMipmap": _emscripten_glGenerateMipmap,
  "_emscripten_glGetActiveAttrib": _emscripten_glGetActiveAttrib,
  "_emscripten_glGetActiveUniform": _emscripten_glGetActiveUniform,
  "_emscripten_glGetActiveUniformBlockName": _emscripten_glGetActiveUniformBlockName,
  "_emscripten_glGetActiveUniformBlockiv": _emscripten_glGetActiveUniformBlockiv,
  "_emscripten_glGetActiveUniformsiv": _emscripten_glGetActiveUniformsiv,
  "_emscripten_glGetAttachedShaders": _emscripten_glGetAttachedShaders,
  "_emscripten_glGetAttribLocation": _emscripten_glGetAttribLocation,
  "_emscripten_glGetBooleanv": _emscripten_glGetBooleanv,
  "_emscripten_glGetBufferParameteri64v": _emscripten_glGetBufferParameteri64v,
  "_emscripten_glGetBufferParameteriv": _emscripten_glGetBufferParameteriv,
  "_emscripten_glGetBufferPointerv": _emscripten_glGetBufferPointerv,
  "_emscripten_glGetError": _emscripten_glGetError,
  "_emscripten_glGetFloatv": _emscripten_glGetFloatv,
  "_emscripten_glGetFragDataLocation": _emscripten_glGetFragDataLocation,
  "_emscripten_glGetFramebufferAttachmentParameteriv": _emscripten_glGetFramebufferAttachmentParameteriv,
  "_emscripten_glGetInteger64i_v": _emscripten_glGetInteger64i_v,
  "_emscripten_glGetInteger64v": _emscripten_glGetInteger64v,
  "_emscripten_glGetIntegeri_v": _emscripten_glGetIntegeri_v,
  "_emscripten_glGetIntegerv": _emscripten_glGetIntegerv,
  "_emscripten_glGetInternalformativ": _emscripten_glGetInternalformativ,
  "_emscripten_glGetProgramBinary": _emscripten_glGetProgramBinary,
  "_emscripten_glGetProgramInfoLog": _emscripten_glGetProgramInfoLog,
  "_emscripten_glGetProgramiv": _emscripten_glGetProgramiv,
  "_emscripten_glGetQueryObjecti64vEXT": _emscripten_glGetQueryObjecti64vEXT,
  "_emscripten_glGetQueryObjectivEXT": _emscripten_glGetQueryObjectivEXT,
  "_emscripten_glGetQueryObjectui64vEXT": _emscripten_glGetQueryObjectui64vEXT,
  "_emscripten_glGetQueryObjectuiv": _emscripten_glGetQueryObjectuiv,
  "_emscripten_glGetQueryObjectuivEXT": _emscripten_glGetQueryObjectuivEXT,
  "_emscripten_glGetQueryiv": _emscripten_glGetQueryiv,
  "_emscripten_glGetQueryivEXT": _emscripten_glGetQueryivEXT,
  "_emscripten_glGetRenderbufferParameteriv": _emscripten_glGetRenderbufferParameteriv,
  "_emscripten_glGetSamplerParameterfv": _emscripten_glGetSamplerParameterfv,
  "_emscripten_glGetSamplerParameteriv": _emscripten_glGetSamplerParameteriv,
  "_emscripten_glGetShaderInfoLog": _emscripten_glGetShaderInfoLog,
  "_emscripten_glGetShaderPrecisionFormat": _emscripten_glGetShaderPrecisionFormat,
  "_emscripten_glGetShaderSource": _emscripten_glGetShaderSource,
  "_emscripten_glGetShaderiv": _emscripten_glGetShaderiv,
  "_emscripten_glGetString": _emscripten_glGetString,
  "_emscripten_glGetStringi": _emscripten_glGetStringi,
  "_emscripten_glGetSynciv": _emscripten_glGetSynciv,
  "_emscripten_glGetTexParameterfv": _emscripten_glGetTexParameterfv,
  "_emscripten_glGetTexParameteriv": _emscripten_glGetTexParameteriv,
  "_emscripten_glGetTransformFeedbackVarying": _emscripten_glGetTransformFeedbackVarying,
  "_emscripten_glGetUniformBlockIndex": _emscripten_glGetUniformBlockIndex,
  "_emscripten_glGetUniformIndices": _emscripten_glGetUniformIndices,
  "_emscripten_glGetUniformLocation": _emscripten_glGetUniformLocation,
  "_emscripten_glGetUniformfv": _emscripten_glGetUniformfv,
  "_emscripten_glGetUniformiv": _emscripten_glGetUniformiv,
  "_emscripten_glGetUniformuiv": _emscripten_glGetUniformuiv,
  "_emscripten_glGetVertexAttribIiv": _emscripten_glGetVertexAttribIiv,
  "_emscripten_glGetVertexAttribIuiv": _emscripten_glGetVertexAttribIuiv,
  "_emscripten_glGetVertexAttribPointerv": _emscripten_glGetVertexAttribPointerv,
  "_emscripten_glGetVertexAttribfv": _emscripten_glGetVertexAttribfv,
  "_emscripten_glGetVertexAttribiv": _emscripten_glGetVertexAttribiv,
  "_emscripten_glHint": _emscripten_glHint,
  "_emscripten_glInvalidateFramebuffer": _emscripten_glInvalidateFramebuffer,
  "_emscripten_glInvalidateSubFramebuffer": _emscripten_glInvalidateSubFramebuffer,
  "_emscripten_glIsBuffer": _emscripten_glIsBuffer,
  "_emscripten_glIsEnabled": _emscripten_glIsEnabled,
  "_emscripten_glIsFramebuffer": _emscripten_glIsFramebuffer,
  "_emscripten_glIsProgram": _emscripten_glIsProgram,
  "_emscripten_glIsQuery": _emscripten_glIsQuery,
  "_emscripten_glIsQueryEXT": _emscripten_glIsQueryEXT,
  "_emscripten_glIsRenderbuffer": _emscripten_glIsRenderbuffer,
  "_emscripten_glIsSampler": _emscripten_glIsSampler,
  "_emscripten_glIsShader": _emscripten_glIsShader,
  "_emscripten_glIsSync": _emscripten_glIsSync,
  "_emscripten_glIsTexture": _emscripten_glIsTexture,
  "_emscripten_glIsTransformFeedback": _emscripten_glIsTransformFeedback,
  "_emscripten_glIsVertexArray": _emscripten_glIsVertexArray,
  "_emscripten_glIsVertexArrayOES": _emscripten_glIsVertexArrayOES,
  "_emscripten_glLineWidth": _emscripten_glLineWidth,
  "_emscripten_glLinkProgram": _emscripten_glLinkProgram,
  "_emscripten_glMapBufferRange": _emscripten_glMapBufferRange,
  "_emscripten_glPauseTransformFeedback": _emscripten_glPauseTransformFeedback,
  "_emscripten_glPixelStorei": _emscripten_glPixelStorei,
  "_emscripten_glPolygonOffset": _emscripten_glPolygonOffset,
  "_emscripten_glProgramBinary": _emscripten_glProgramBinary,
  "_emscripten_glProgramParameteri": _emscripten_glProgramParameteri,
  "_emscripten_glQueryCounterEXT": _emscripten_glQueryCounterEXT,
  "_emscripten_glReadBuffer": _emscripten_glReadBuffer,
  "_emscripten_glReadPixels": _emscripten_glReadPixels,
  "_emscripten_glReleaseShaderCompiler": _emscripten_glReleaseShaderCompiler,
  "_emscripten_glRenderbufferStorage": _emscripten_glRenderbufferStorage,
  "_emscripten_glRenderbufferStorageMultisample": _emscripten_glRenderbufferStorageMultisample,
  "_emscripten_glResumeTransformFeedback": _emscripten_glResumeTransformFeedback,
  "_emscripten_glSampleCoverage": _emscripten_glSampleCoverage,
  "_emscripten_glSamplerParameterf": _emscripten_glSamplerParameterf,
  "_emscripten_glSamplerParameterfv": _emscripten_glSamplerParameterfv,
  "_emscripten_glSamplerParameteri": _emscripten_glSamplerParameteri,
  "_emscripten_glSamplerParameteriv": _emscripten_glSamplerParameteriv,
  "_emscripten_glScissor": _emscripten_glScissor,
  "_emscripten_glShaderBinary": _emscripten_glShaderBinary,
  "_emscripten_glShaderSource": _emscripten_glShaderSource,
  "_emscripten_glStencilFunc": _emscripten_glStencilFunc,
  "_emscripten_glStencilFuncSeparate": _emscripten_glStencilFuncSeparate,
  "_emscripten_glStencilMask": _emscripten_glStencilMask,
  "_emscripten_glStencilMaskSeparate": _emscripten_glStencilMaskSeparate,
  "_emscripten_glStencilOp": _emscripten_glStencilOp,
  "_emscripten_glStencilOpSeparate": _emscripten_glStencilOpSeparate,
  "_emscripten_glTexImage2D": _emscripten_glTexImage2D,
  "_emscripten_glTexImage3D": _emscripten_glTexImage3D,
  "_emscripten_glTexParameterf": _emscripten_glTexParameterf,
  "_emscripten_glTexParameterfv": _emscripten_glTexParameterfv,
  "_emscripten_glTexParameteri": _emscripten_glTexParameteri,
  "_emscripten_glTexParameteriv": _emscripten_glTexParameteriv,
  "_emscripten_glTexStorage2D": _emscripten_glTexStorage2D,
  "_emscripten_glTexStorage3D": _emscripten_glTexStorage3D,
  "_emscripten_glTexSubImage2D": _emscripten_glTexSubImage2D,
  "_emscripten_glTexSubImage3D": _emscripten_glTexSubImage3D,
  "_emscripten_glTransformFeedbackVaryings": _emscripten_glTransformFeedbackVaryings,
  "_emscripten_glUniform1f": _emscripten_glUniform1f,
  "_emscripten_glUniform1fv": _emscripten_glUniform1fv,
  "_emscripten_glUniform1i": _emscripten_glUniform1i,
  "_emscripten_glUniform1iv": _emscripten_glUniform1iv,
  "_emscripten_glUniform1ui": _emscripten_glUniform1ui,
  "_emscripten_glUniform1uiv": _emscripten_glUniform1uiv,
  "_emscripten_glUniform2f": _emscripten_glUniform2f,
  "_emscripten_glUniform2fv": _emscripten_glUniform2fv,
  "_emscripten_glUniform2i": _emscripten_glUniform2i,
  "_emscripten_glUniform2iv": _emscripten_glUniform2iv,
  "_emscripten_glUniform2ui": _emscripten_glUniform2ui,
  "_emscripten_glUniform2uiv": _emscripten_glUniform2uiv,
  "_emscripten_glUniform3f": _emscripten_glUniform3f,
  "_emscripten_glUniform3fv": _emscripten_glUniform3fv,
  "_emscripten_glUniform3i": _emscripten_glUniform3i,
  "_emscripten_glUniform3iv": _emscripten_glUniform3iv,
  "_emscripten_glUniform3ui": _emscripten_glUniform3ui,
  "_emscripten_glUniform3uiv": _emscripten_glUniform3uiv,
  "_emscripten_glUniform4f": _emscripten_glUniform4f,
  "_emscripten_glUniform4fv": _emscripten_glUniform4fv,
  "_emscripten_glUniform4i": _emscripten_glUniform4i,
  "_emscripten_glUniform4iv": _emscripten_glUniform4iv,
  "_emscripten_glUniform4ui": _emscripten_glUniform4ui,
  "_emscripten_glUniform4uiv": _emscripten_glUniform4uiv,
  "_emscripten_glUniformBlockBinding": _emscripten_glUniformBlockBinding,
  "_emscripten_glUniformMatrix2fv": _emscripten_glUniformMatrix2fv,
  "_emscripten_glUniformMatrix2x3fv": _emscripten_glUniformMatrix2x3fv,
  "_emscripten_glUniformMatrix2x4fv": _emscripten_glUniformMatrix2x4fv,
  "_emscripten_glUniformMatrix3fv": _emscripten_glUniformMatrix3fv,
  "_emscripten_glUniformMatrix3x2fv": _emscripten_glUniformMatrix3x2fv,
  "_emscripten_glUniformMatrix3x4fv": _emscripten_glUniformMatrix3x4fv,
  "_emscripten_glUniformMatrix4fv": _emscripten_glUniformMatrix4fv,
  "_emscripten_glUniformMatrix4x2fv": _emscripten_glUniformMatrix4x2fv,
  "_emscripten_glUniformMatrix4x3fv": _emscripten_glUniformMatrix4x3fv,
  "_emscripten_glUnmapBuffer": _emscripten_glUnmapBuffer,
  "_emscripten_glUseProgram": _emscripten_glUseProgram,
  "_emscripten_glValidateProgram": _emscripten_glValidateProgram,
  "_emscripten_glVertexAttrib1f": _emscripten_glVertexAttrib1f,
  "_emscripten_glVertexAttrib1fv": _emscripten_glVertexAttrib1fv,
  "_emscripten_glVertexAttrib2f": _emscripten_glVertexAttrib2f,
  "_emscripten_glVertexAttrib2fv": _emscripten_glVertexAttrib2fv,
  "_emscripten_glVertexAttrib3f": _emscripten_glVertexAttrib3f,
  "_emscripten_glVertexAttrib3fv": _emscripten_glVertexAttrib3fv,
  "_emscripten_glVertexAttrib4f": _emscripten_glVertexAttrib4f,
  "_emscripten_glVertexAttrib4fv": _emscripten_glVertexAttrib4fv,
  "_emscripten_glVertexAttribDivisor": _emscripten_glVertexAttribDivisor,
  "_emscripten_glVertexAttribDivisorANGLE": _emscripten_glVertexAttribDivisorANGLE,
  "_emscripten_glVertexAttribDivisorARB": _emscripten_glVertexAttribDivisorARB,
  "_emscripten_glVertexAttribDivisorEXT": _emscripten_glVertexAttribDivisorEXT,
  "_emscripten_glVertexAttribDivisorNV": _emscripten_glVertexAttribDivisorNV,
  "_emscripten_glVertexAttribI4i": _emscripten_glVertexAttribI4i,
  "_emscripten_glVertexAttribI4iv": _emscripten_glVertexAttribI4iv,
  "_emscripten_glVertexAttribI4ui": _emscripten_glVertexAttribI4ui,
  "_emscripten_glVertexAttribI4uiv": _emscripten_glVertexAttribI4uiv,
  "_emscripten_glVertexAttribIPointer": _emscripten_glVertexAttribIPointer,
  "_emscripten_glVertexAttribPointer": _emscripten_glVertexAttribPointer,
  "_emscripten_glViewport": _emscripten_glViewport,
  "_emscripten_glWaitSync": _emscripten_glWaitSync,
  "_emscripten_log": _emscripten_log,
  "_emscripten_log_js": _emscripten_log_js,
  "_emscripten_memcpy_big": _emscripten_memcpy_big,
  "_emscripten_performance_now": _emscripten_performance_now,
  "_emscripten_request_animation_frame_loop": _emscripten_request_animation_frame_loop,
  "_emscripten_resize_heap": _emscripten_resize_heap,
  "_emscripten_set_canvas_element_size": _emscripten_set_canvas_element_size,
  "_emscripten_start_fetch": _emscripten_start_fetch,
  "_emscripten_throw_string": _emscripten_throw_string,
  "_emscripten_webgl_create_context": _emscripten_webgl_create_context,
  "_emscripten_webgl_destroy_context": _emscripten_webgl_destroy_context,
  "_emscripten_webgl_destroy_context_calling_thread": _emscripten_webgl_destroy_context_calling_thread,
  "_emscripten_webgl_do_create_context": _emscripten_webgl_do_create_context,
  "_emscripten_webgl_init_context_attributes": _emscripten_webgl_init_context_attributes,
  "_emscripten_webgl_make_context_current": _emscripten_webgl_make_context_current,
  "_exit": _exit,
  "_glActiveTexture": _glActiveTexture,
  "_glAttachShader": _glAttachShader,
  "_glBindBuffer": _glBindBuffer,
  "_glBindFramebuffer": _glBindFramebuffer,
  "_glBindRenderbuffer": _glBindRenderbuffer,
  "_glBindTexture": _glBindTexture,
  "_glBlendColor": _glBlendColor,
  "_glBlendEquationSeparate": _glBlendEquationSeparate,
  "_glBlendFuncSeparate": _glBlendFuncSeparate,
  "_glBufferData": _glBufferData,
  "_glBufferSubData": _glBufferSubData,
  "_glCheckFramebufferStatus": _glCheckFramebufferStatus,
  "_glClear": _glClear,
  "_glClearColor": _glClearColor,
  "_glClearDepthf": _glClearDepthf,
  "_glClearStencil": _glClearStencil,
  "_glColorMask": _glColorMask,
  "_glCompileShader": _glCompileShader,
  "_glCompressedTexImage2D": _glCompressedTexImage2D,
  "_glCompressedTexSubImage2D": _glCompressedTexSubImage2D,
  "_glCreateProgram": _glCreateProgram,
  "_glCreateShader": _glCreateShader,
  "_glCullFace": _glCullFace,
  "_glDeleteBuffers": _glDeleteBuffers,
  "_glDeleteFramebuffers": _glDeleteFramebuffers,
  "_glDeleteProgram": _glDeleteProgram,
  "_glDeleteRenderbuffers": _glDeleteRenderbuffers,
  "_glDeleteShader": _glDeleteShader,
  "_glDeleteTextures": _glDeleteTextures,
  "_glDepthFunc": _glDepthFunc,
  "_glDepthMask": _glDepthMask,
  "_glDetachShader": _glDetachShader,
  "_glDisable": _glDisable,
  "_glDisableVertexAttribArray": _glDisableVertexAttribArray,
  "_glDrawArrays": _glDrawArrays,
  "_glDrawElements": _glDrawElements,
  "_glEnable": _glEnable,
  "_glEnableVertexAttribArray": _glEnableVertexAttribArray,
  "_glFlush": _glFlush,
  "_glFramebufferRenderbuffer": _glFramebufferRenderbuffer,
  "_glFramebufferTexture2D": _glFramebufferTexture2D,
  "_glFrontFace": _glFrontFace,
  "_glGenBuffers": _glGenBuffers,
  "_glGenFramebuffers": _glGenFramebuffers,
  "_glGenRenderbuffers": _glGenRenderbuffers,
  "_glGenTextures": _glGenTextures,
  "_glGenerateMipmap": _glGenerateMipmap,
  "_glGetActiveAttrib": _glGetActiveAttrib,
  "_glGetActiveUniform": _glGetActiveUniform,
  "_glGetAttribLocation": _glGetAttribLocation,
  "_glGetError": _glGetError,
  "_glGetFloatv": _glGetFloatv,
  "_glGetIntegerv": _glGetIntegerv,
  "_glGetProgramInfoLog": _glGetProgramInfoLog,
  "_glGetProgramiv": _glGetProgramiv,
  "_glGetShaderInfoLog": _glGetShaderInfoLog,
  "_glGetShaderiv": _glGetShaderiv,
  "_glGetString": _glGetString,
  "_glGetUniformLocation": _glGetUniformLocation,
  "_glLinkProgram": _glLinkProgram,
  "_glPixelStorei": _glPixelStorei,
  "_glReadPixels": _glReadPixels,
  "_glRenderbufferStorage": _glRenderbufferStorage,
  "_glScissor": _glScissor,
  "_glShaderSource": _glShaderSource,
  "_glStencilFuncSeparate": _glStencilFuncSeparate,
  "_glStencilOpSeparate": _glStencilOpSeparate,
  "_glTexImage2D": _glTexImage2D,
  "_glTexParameterf": _glTexParameterf,
  "_glTexParameterfv": _glTexParameterfv,
  "_glTexParameteri": _glTexParameteri,
  "_glTexSubImage2D": _glTexSubImage2D,
  "_glUniform1i": _glUniform1i,
  "_glUniform1iv": _glUniform1iv,
  "_glUniform4fv": _glUniform4fv,
  "_glUniformMatrix3fv": _glUniformMatrix3fv,
  "_glUniformMatrix4fv": _glUniformMatrix4fv,
  "_glUseProgram": _glUseProgram,
  "_glVertexAttribPointer": _glVertexAttribPointer,
  "_glViewport": _glViewport,
  "_js_html_checkLoadImage": _js_html_checkLoadImage,
  "_js_html_finishLoadImage": _js_html_finishLoadImage,
  "_js_html_freeImage": _js_html_freeImage,
  "_js_html_getCanvasSize": _js_html_getCanvasSize,
  "_js_html_getDPIScale": _js_html_getDPIScale,
  "_js_html_getFrameSize": _js_html_getFrameSize,
  "_js_html_getScreenSize": _js_html_getScreenSize,
  "_js_html_imageToMemory": _js_html_imageToMemory,
  "_js_html_init": _js_html_init,
  "_js_html_initImageLoading": _js_html_initImageLoading,
  "_js_html_loadImage": _js_html_loadImage,
  "_js_html_setCanvasSize": _js_html_setCanvasSize,
  "_llvm_bswap_i64": _llvm_bswap_i64,
  "_llvm_trap": _llvm_trap,
  "_nanosleep": _nanosleep,
  "_usleep": _usleep,
  "abortStackOverflow": abortStackOverflow,
  "demangle": demangle,
  "emscriptenWebGLGet": emscriptenWebGLGet,
  "emscriptenWebGLGetIndexed": emscriptenWebGLGetIndexed,
  "emscriptenWebGLGetTexPixelData": emscriptenWebGLGetTexPixelData,
  "emscriptenWebGLGetUniform": emscriptenWebGLGetUniform,
  "emscriptenWebGLGetVertexAttrib": emscriptenWebGLGetVertexAttrib,
  "flush_NO_FILESYSTEM": flush_NO_FILESYSTEM,
  "jsStackTrace": jsStackTrace,
  "stringToNewUTF8": stringToNewUTF8,
  "warnOnce": warnOnce,
  "tempDoublePtr": tempDoublePtr,
  "DYNAMICTOP_PTR": DYNAMICTOP_PTR
}
// EMSCRIPTEN_START_ASM
var asm =Module["asm"]// EMSCRIPTEN_END_ASM
    
;



// === Auto-generated postamble setup entry stuff ===

if (!Module["intArrayFromString"]) Module["intArrayFromString"] = function() { abort("'intArrayFromString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["intArrayToString"]) Module["intArrayToString"] = function() { abort("'intArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["ccall"]) Module["ccall"] = function() { abort("'ccall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["cwrap"]) Module["cwrap"] = function() { abort("'cwrap' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setValue"]) Module["setValue"] = function() { abort("'setValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getValue"]) Module["getValue"] = function() { abort("'getValue' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocate"]) Module["allocate"] = function() { abort("'allocate' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getMemory"]) Module["getMemory"] = function() { abort("'getMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["AsciiToString"]) Module["AsciiToString"] = function() { abort("'AsciiToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToAscii"]) Module["stringToAscii"] = function() { abort("'stringToAscii' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF8ArrayToString"]) Module["UTF8ArrayToString"] = function() { abort("'UTF8ArrayToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF8ToString"]) Module["UTF8ToString"] = function() { abort("'UTF8ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF8Array"]) Module["stringToUTF8Array"] = function() { abort("'stringToUTF8Array' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF8"]) Module["stringToUTF8"] = function() { abort("'stringToUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF8"]) Module["lengthBytesUTF8"] = function() { abort("'lengthBytesUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF16ToString"]) Module["UTF16ToString"] = function() { abort("'UTF16ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF16"]) Module["stringToUTF16"] = function() { abort("'stringToUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF16"]) Module["lengthBytesUTF16"] = function() { abort("'lengthBytesUTF16' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["UTF32ToString"]) Module["UTF32ToString"] = function() { abort("'UTF32ToString' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stringToUTF32"]) Module["stringToUTF32"] = function() { abort("'stringToUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["lengthBytesUTF32"]) Module["lengthBytesUTF32"] = function() { abort("'lengthBytesUTF32' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["allocateUTF8"]) Module["allocateUTF8"] = function() { abort("'allocateUTF8' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["stackTrace"]) Module["stackTrace"] = function() { abort("'stackTrace' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreRun"]) Module["addOnPreRun"] = function() { abort("'addOnPreRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnInit"]) Module["addOnInit"] = function() { abort("'addOnInit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPreMain"]) Module["addOnPreMain"] = function() { abort("'addOnPreMain' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnExit"]) Module["addOnExit"] = function() { abort("'addOnExit' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addOnPostRun"]) Module["addOnPostRun"] = function() { abort("'addOnPostRun' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeStringToMemory"]) Module["writeStringToMemory"] = function() { abort("'writeStringToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeArrayToMemory"]) Module["writeArrayToMemory"] = function() { abort("'writeArrayToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["writeAsciiToMemory"]) Module["writeAsciiToMemory"] = function() { abort("'writeAsciiToMemory' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addRunDependency"]) Module["addRunDependency"] = function() { abort("'addRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["removeRunDependency"]) Module["removeRunDependency"] = function() { abort("'removeRunDependency' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["ENV"]) Module["ENV"] = function() { abort("'ENV' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS"]) Module["FS"] = function() { abort("'FS' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["FS_createFolder"]) Module["FS_createFolder"] = function() { abort("'FS_createFolder' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPath"]) Module["FS_createPath"] = function() { abort("'FS_createPath' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDataFile"]) Module["FS_createDataFile"] = function() { abort("'FS_createDataFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createPreloadedFile"]) Module["FS_createPreloadedFile"] = function() { abort("'FS_createPreloadedFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLazyFile"]) Module["FS_createLazyFile"] = function() { abort("'FS_createLazyFile' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createLink"]) Module["FS_createLink"] = function() { abort("'FS_createLink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_createDevice"]) Module["FS_createDevice"] = function() { abort("'FS_createDevice' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["FS_unlink"]) Module["FS_unlink"] = function() { abort("'FS_unlink' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ). Alternatively, forcing filesystem support (-s FORCE_FILESYSTEM=1) can export this for you") };
if (!Module["GL"]) Module["GL"] = function() { abort("'GL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynamicAlloc"]) Module["dynamicAlloc"] = function() { abort("'dynamicAlloc' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["warnOnce"]) Module["warnOnce"] = function() { abort("'warnOnce' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadDynamicLibrary"]) Module["loadDynamicLibrary"] = function() { abort("'loadDynamicLibrary' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["loadWebAssemblyModule"]) Module["loadWebAssemblyModule"] = function() { abort("'loadWebAssemblyModule' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getLEB"]) Module["getLEB"] = function() { abort("'getLEB' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFunctionTables"]) Module["getFunctionTables"] = function() { abort("'getFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["alignFunctionTables"]) Module["alignFunctionTables"] = function() { abort("'alignFunctionTables' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["registerFunctions"]) Module["registerFunctions"] = function() { abort("'registerFunctions' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["addFunction"]) Module["addFunction"] = function() { abort("'addFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["removeFunction"]) Module["removeFunction"] = function() { abort("'removeFunction' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getFuncWrapper"]) Module["getFuncWrapper"] = function() { abort("'getFuncWrapper' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["prettyPrint"]) Module["prettyPrint"] = function() { abort("'prettyPrint' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["makeBigInt"]) Module["makeBigInt"] = function() { abort("'makeBigInt' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["dynCall"]) Module["dynCall"] = function() { abort("'dynCall' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getCompilerSetting"]) Module["getCompilerSetting"] = function() { abort("'getCompilerSetting' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["print"]) Module["print"] = function() { abort("'print' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["printErr"]) Module["printErr"] = function() { abort("'printErr' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["getTempRet0"]) Module["getTempRet0"] = function() { abort("'getTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };
if (!Module["setTempRet0"]) Module["setTempRet0"] = function() { abort("'setTempRet0' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") };if (!Module["ALLOC_NORMAL"]) Object.defineProperty(Module, "ALLOC_NORMAL", { get: function() { abort("'ALLOC_NORMAL' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_STACK"]) Object.defineProperty(Module, "ALLOC_STACK", { get: function() { abort("'ALLOC_STACK' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_DYNAMIC"]) Object.defineProperty(Module, "ALLOC_DYNAMIC", { get: function() { abort("'ALLOC_DYNAMIC' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });
if (!Module["ALLOC_NONE"]) Object.defineProperty(Module, "ALLOC_NONE", { get: function() { abort("'ALLOC_NONE' was not exported. add it to EXTRA_EXPORTED_RUNTIME_METHODS (see the FAQ)") } });

function run() {

    var ret = _main();

  checkStackCookie();
}

function initRuntime(asm) {
  runtimeInitialized = true;


  writeStackCookie();

  asm['globalCtors']();

  
}


// Initialize wasm (asynchronous)
var env = asmLibraryArg;
env['memory'] = wasmMemory;
env['table'] = new WebAssembly.Table({ 'initial': 3373
  , 'maximum': 3373
  , 'element': 'anyfunc' });
env['__memory_base'] = STATIC_BASE;
env['__table_base'] = 0;

var imports = {
  'env': env
  , 'global': {
    'NaN': NaN,
    'Infinity': Infinity
  },
  'global.Math': Math,
  'asm2wasm': {
    'f64-rem': function(x, y) { return x % y; },
    'debugger': function() {
      debugger;
    }
  }
};

var ___cxa_demangle,_emscripten_is_main_browser_thread,_free,_htonl,_htons,_llvm_bswap_i16,_llvm_bswap_i32,_main,_malloc,_memalign,_memcpy,_memmove,_memset,_ntohs,_sbrk,_strlen,globalCtors,dynCall_fi,dynCall_i,dynCall_idi,dynCall_ii,dynCall_iid,dynCall_iif,dynCall_iii,dynCall_iiii,dynCall_iiiii,dynCall_iiiiiii,dynCall_iiiiiiiii,dynCall_iiiiiiiiiiiii,dynCall_iiiiiiiiiiiiii,dynCall_iiiiji,dynCall_iiij,dynCall_iij,dynCall_iijii,dynCall_ji,dynCall_jiji,dynCall_v,dynCall_vf,dynCall_vff,dynCall_vffff,dynCall_vfi,dynCall_vi,dynCall_vif,dynCall_viff,dynCall_vifff,dynCall_viffff,dynCall_vii,dynCall_viif,dynCall_viifi,dynCall_viii,dynCall_viiii,dynCall_viiiii,dynCall_viiiiii,dynCall_viiiiiii,dynCall_viiiiiiii,dynCall_viiiiiiiii,dynCall_viiiiiiiiii,dynCall_viiiiiiiiiii,dynCall_viiiiiiiiiiiiiii,dynCall_viij,dynCall_vijii;

// Streaming Wasm compilation is not possible in Node.js, it does not support the fetch() API.
// In synchronous Wasm compilation mode, Module['wasm'] should contain a typed array of the Wasm object data.
if (!Module['wasm']) throw 'Must load WebAssembly Module in to variable Module.wasm before adding compiled output .js script to the DOM';
Module['wasmInstance'] = WebAssembly.instantiate(Module['wasm'], imports).then(function(output) {
  var asm = output.instance.exports;

  ___cxa_demangle = asm["___cxa_demangle"];
_emscripten_is_main_browser_thread = asm["_emscripten_is_main_browser_thread"];
_free = asm["_free"];
_htonl = asm["_htonl"];
_htons = asm["_htons"];
_llvm_bswap_i16 = asm["_llvm_bswap_i16"];
_llvm_bswap_i32 = asm["_llvm_bswap_i32"];
_main = asm["_main"];
_malloc = asm["_malloc"];
_memalign = asm["_memalign"];
_memcpy = asm["_memcpy"];
_memmove = asm["_memmove"];
_memset = asm["_memset"];
_ntohs = asm["_ntohs"];
_sbrk = asm["_sbrk"];
_strlen = asm["_strlen"];
globalCtors = asm["globalCtors"];
dynCall_fi = asm["dynCall_fi"];
dynCall_i = asm["dynCall_i"];
dynCall_idi = asm["dynCall_idi"];
dynCall_ii = asm["dynCall_ii"];
dynCall_iid = asm["dynCall_iid"];
dynCall_iif = asm["dynCall_iif"];
dynCall_iii = asm["dynCall_iii"];
dynCall_iiii = asm["dynCall_iiii"];
dynCall_iiiii = asm["dynCall_iiiii"];
dynCall_iiiiiii = asm["dynCall_iiiiiii"];
dynCall_iiiiiiiii = asm["dynCall_iiiiiiiii"];
dynCall_iiiiiiiiiiiii = asm["dynCall_iiiiiiiiiiiii"];
dynCall_iiiiiiiiiiiiii = asm["dynCall_iiiiiiiiiiiiii"];
dynCall_iiiiji = asm["dynCall_iiiiji"];
dynCall_iiij = asm["dynCall_iiij"];
dynCall_iij = asm["dynCall_iij"];
dynCall_iijii = asm["dynCall_iijii"];
dynCall_ji = asm["dynCall_ji"];
dynCall_jiji = asm["dynCall_jiji"];
dynCall_v = asm["dynCall_v"];
dynCall_vf = asm["dynCall_vf"];
dynCall_vff = asm["dynCall_vff"];
dynCall_vffff = asm["dynCall_vffff"];
dynCall_vfi = asm["dynCall_vfi"];
dynCall_vi = asm["dynCall_vi"];
dynCall_vif = asm["dynCall_vif"];
dynCall_viff = asm["dynCall_viff"];
dynCall_vifff = asm["dynCall_vifff"];
dynCall_viffff = asm["dynCall_viffff"];
dynCall_vii = asm["dynCall_vii"];
dynCall_viif = asm["dynCall_viif"];
dynCall_viifi = asm["dynCall_viifi"];
dynCall_viii = asm["dynCall_viii"];
dynCall_viiii = asm["dynCall_viiii"];
dynCall_viiiii = asm["dynCall_viiiii"];
dynCall_viiiiii = asm["dynCall_viiiiii"];
dynCall_viiiiiii = asm["dynCall_viiiiiii"];
dynCall_viiiiiiii = asm["dynCall_viiiiiiii"];
dynCall_viiiiiiiii = asm["dynCall_viiiiiiiii"];
dynCall_viiiiiiiiii = asm["dynCall_viiiiiiiiii"];
dynCall_viiiiiiiiiii = asm["dynCall_viiiiiiiiiii"];
dynCall_viiiiiiiiiiiiiii = asm["dynCall_viiiiiiiiiiiiiii"];
dynCall_viij = asm["dynCall_viij"];
dynCall_vijii = asm["dynCall_vijii"];


    initRuntime(asm);
    ready();
})
.catch(function(error) {
  console.error(error);
})
;








// {{MODULE_ADDITIONS}}



