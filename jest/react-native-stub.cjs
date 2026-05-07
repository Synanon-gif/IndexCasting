/** Jest stub: Standard = native (kein window). Einzelne Tests setzen Platform per jest.unstable_mockModule / doMock. */
const React = require('react');

function el(tag) {
  return function Mock(props) {
    return React.createElement(tag, props, props.children);
  };
}

module.exports = {
  Platform: { OS: 'ios' },
  View: el('View'),
  Image: el('Image'),
  Text: el('Text'),
  TouchableOpacity: el('TouchableOpacity'),
  ActivityIndicator: el('ActivityIndicator'),
  StyleSheet: { create: (s) => s, flatten: (s) => s },
};
