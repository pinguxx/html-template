/**
 * This is an implementation-in-progress of a WHATWG/HTML proposal #2254
 * Standardize <template> variables and event handlers
 * https://github.com/whatwg/html/issues/2254
 *
 * MIT License
 *
 * Mev-Rael (mevrael@gmail.com)
 *
 * Please provide your feedback, PRs should be submitted here
 * https://github.com/Mevrael/html-template
 *
 * Adds a .parse(data) method to a Template prototype
 *
 * Currently doest not support any statements like if/endif blocks
 */


Object.assign(HTMLTemplateElement.prototype, {

  tokenTypes: {
    UNDEFINED: 0,
    VAR: 1,
    NESTED_VAR: 2,
    IF: 3,
    ENDIF: 4
  },

  compare : {
    '==': function (a, b) { return a == b },
    '===': function (a, b) { return a === b },
    '!=': function (a, b) { return a != b },
    '!==': function (a, b) { return a !== b },
    '<': function (a, b) { return a < b },
    '>': function (a, b) { return a > b },
    '<=': function (a, b) { return a <= b },
    '>=': function (a, b) { return a >= b },
    '&amp;&amp;': function (a, b) { return !!a && !!b },
    '||': function (a, b) { return !!a || !!b }
  },

  parse(data) {
    let html = this.getRootNodeAsHtml();
    const tokens = this.getTokens(html);
    let delta = 0; // when replacing tokens, increase/decrease delta length so next token would be replaced in correct position of html
    let skip = -1;
    let tempDelta = 0;
    tokens.forEach((token, ix) => {
      //console.log(token, ix);
      let replaceWith = '';
      if (skip >= 0) {
        if (token.type === this.tokenTypes.ENDIF) {
          html = html.substr(0, skip) + replaceWith + html.substr(token.endsAt - tempDelta);
          delta += (token.endsAt - tempDelta) - skip ;
          skip = -1;
        }
        return;
      }

      replaceWith = this.parseToken(token, data);
      if (token.type === this.tokenTypes.IF) {
        if (replaceWith === false) {
          skip = token.startsAt - delta;
          replaceWith = '';
        } else {
          replaceWith = '';
        }
      } 
      html = html.substr(0, token.startsAt - delta) + replaceWith + html.substr(token.endsAt - delta);
      delta += token.length - replaceWith.length;
      tempDelta += token.length - replaceWith.length;
    });
    return this.htmlToNode(html);
  },

  htmlToNode(html) {
    return document.createRange().createContextualFragment(html).firstChild;
  },

  getRootNode() {
    const nodes = this.content.childNodes;
    const l = nodes.length;
    for (let k = 0; k < l; k++) {
      const node = nodes[k];
      if (node.nodeType === Node.ELEMENT_NODE) {
        return node;
      }
    }
    throw new SyntaxError('Template has no root element node');
  },

  getRootNodeAsHtml() {
    return this.getRootNode().outerHTML;
  },

  // get all the strings within {{ }} in template root node
  getTokens(html) {
    let tokens = [];
    let startAt = 0;
    while (token = this.getNextToken(html, startAt)) {
      tokens.push(token);
      startAt = token.endsAt;
    }
    return tokens;
  },

  // gets next token from an HTML string starting at startAt position
  // if no more tokens found - returns false
  // if token is not closed with }} - throws a SyntaxError
  // if token is found - returns an object:
  // {
  //   value: string - contents of expression between {{ }},
  //   startsAt: position of {{
  //   endsAt: position of }}
  //   length: total length of expression starting from the first "{" and ending with last "}"
  // }
  getNextToken(html, startAt = 0) {
    let startPos = html.indexOf('{{', startAt);
    if (startPos === -1) {
      return false;
    }
    let endPos = html.indexOf('}}', startPos);
    if (endPos === -1) {
      throw new SyntaxError('Template expression is not closed with }}');
    }
    startPos += 2;
    const value = html.substr(startPos, endPos - startPos).trim();
    startPos -= 2;
    endPos += 2;
    return {
      type: this.getTokenTypeByValue(value),
      value: value,
      startsAt: startPos,
      endsAt: endPos,
      length: endPos - startPos
    }
  },

  getTokenTypeByValue(value) {
    if (value.indexOf('if') === 0) {
      return this.tokenTypes.IF;
    } else if (value === 'endif') {
      return this.tokenTypes.ENDIF;
    } else if (value.indexOf('.') !== -1) {
      return this.tokenTypes.NESTED_VAR;
    } else {
      return this.tokenTypes.VAR;
    }
  },

  parseToken(token, data) {
    return this['parseToken' + token.type](token.value, data);
  },

  // VAR
  parseToken1(value, data) {
    if (data[value] === undefined) {
      return '';
    } else {
      return data[value].toString();
    }
  },

  // NESTED_VAR
  parseToken2(value, data) {
    let parts = value.split('.');
    const l = parts.length;
    let curNestData = data;

    const isFunction = (obj) => {
      return Object.prototype.toString.call(obj) == '[object Function]';
    }

    for (let k = 0; k < l; k++) {
      if (curNestData[parts[k]] === undefined) {
        return '';
      } else {
        if (isFunction(curNestData[parts[k]])) {
          curNestData = curNestData[parts[k]]();
        } else {
          curNestData = curNestData[parts[k]];
        }
      }
    }
    return curNestData;
  },

  tokenRegex: /(\(\)|\&amp;\&amp;|\(|\)|===|==|>=|<=|!==|!=|<|>|\|\|)+/,

  // IF
  parseToken3(value, data) {
    let cValue = value.slice(2).trim();
    const tokens = cValue.split(this.tokenRegex);
    let leftSide = null,
      rightSide = null,
      compareFn = null,
      startGroup = false,
      store = {
        left: null,
        fn: null
      };
    //console.log(cValue, tokens);

    function getStringOrValue(token) {
      let newVal;
      if (token.lastIndexOf('\'', 0) === 0 || token.lastIndexOf('"', 0) === 0) {
        return token.substr(1,token.length -2);
      } else {
        newVal = this.parseToken2(token, data);
        if (newVal == null) {
          newVal = undefined;
        }
      }
      return newVal;
    }

    tokens.forEach((tok) => {
      let token = tok.trim();
      if (token === '' || token === '()') {
        //nothing
        return;
      }
      if (token === '(') {
        startGroup = true;
        if (leftSide !== null) {
          store.left = leftSide;
          store.fn = compareFn;
          compareFn = null;
          leftSide = null;
        }
        return;
      }
      if (token === ')') {
        if (store.left === null) {
          return;
        }
        startGroup = false;
        rightSide = leftSide;
        leftSide = store.left;
        compareFn = store.fn;
      }
      if (!this.compare[token]) {
        //variable or string
        if (leftSide === null) {
          leftSide = getStringOrValue.call(this, token);
        } else if (rightSide === null) {
          rightSide = getStringOrValue.call(this, token);
        }
      } else {
        compareFn = this.compare[token];
      }
      if (leftSide !== null && rightSide !== null && compareFn !== null) {
        leftSide = compareFn(leftSide, rightSide);
        rightSide = null;
      }
    });

    //console.log(leftSide, !!leftSide);

    return !!leftSide;
  },

  // ENDIF
  parseToken4(value, data) {
    return '';
  },

});
