(function () {
	'use strict';

	const del = function (input, count) {
			const selectionStart = input.selectionStart,
				selectionEnd = input.selectionEnd;

			if (selectionEnd - selectionStart) {
				// Deleting when text is selected deletes only the selected text.
				input.value = input.value.substring(0, selectionStart) + input.value.substring(selectionEnd);
				input.setSelectionRange(selectionStart, selectionStart);
			} else {
				const deletionStart = Math.max(Math.min(selectionStart, selectionStart + count), 0),
					deletionEnd = Math.min(Math.max(selectionEnd, selectionEnd + count), input.value.length);

				input.value = input.value.substring(0, deletionStart) + input.value.substring(deletionEnd);
				input.setSelectionRange(deletionStart, deletionStart);
			}
		},
		isShifted = () => getKeyboard().classList.contains('shift'),
		toggleShift = function (input, force) {
			const keyboard = getKeyboard(),
				doShift = force === undefined ? !isShifted() : force;

			keyboard.classList.toggle('shift', doShift);
			keyboard.querySelectorAll('button').forEach(keyElement => {
				const key = keyElement.keyData,
					keyChar = key.label || (doShift ? (key.upper || key.lower.toUpperCase()) : key.lower);
				keyElement.textContent = keyChar;
			});
		},
		moveCursor = function (input, distance) {
			const selectionStart = input.selectionStart,
				selectionEnd = input.selectionEnd,
				moveTo = Math.min(Math.max((selectionEnd - selectionStart) ? (distance > 0 ? selectionEnd : selectionStart) : (selectionStart + distance), 0), input.value.length);

			input.setSelectionRange(moveTo, moveTo);
		},
		moveCursorLine = function (input, lines) {},
		enter = function (input) {
			if (input.nodeName === 'INPUT') {
				input.blur();
				input.dispatchEvent(new Event('change', { bubbles: true }));
			} else {
				insertChar(input, { lower: '\n' });
			}
		},
		insertChar = function (input, key) {
			const selectionStart = input.selectionStart,
				selectionEnd = input.selectionEnd,
				keyChar = getKeyboard().classList.contains('shift') ? key.upper || key.lower.toUpperCase() : key.lower;

			input.value = input.value.substring(0, selectionStart) + keyChar + input.value.substring(selectionEnd);
			input.setSelectionRange(selectionStart + 1, selectionStart + 1);

			if (isShifted()) {
				toggleShift(input, false);
			}
		},
		incrementDigit = function (input, amount) {
			const hadValue = !!input.value.length,
				originalValue = hadValue ? parseFloat(input.value) : 0,
				selectionStart = Math.max(input.selectionStart - (originalValue < 0 ? 1 : 0), 0), // Subtract one if value is negative so that the '-' character doesn't cause everything to be off by one position.
				decimalPosition = ((input.value.indexOf('.') + 1) || (input.value.length + 1)) - (originalValue < 0 ? 1 : 0),
				incrementMagnitude = input.value.length
					? Math.max(Math.pow(10, (decimalPosition - selectionStart) - (decimalPosition > selectionStart ? 1 : 0)), input.step || 1)
					: input.step || 1,
				min = input.min.length ? parseFloat(input.min) : Number.NEGATIVE_INFINITY,
				max = input.max.length ? parseFloat(input.max) : Number.POSITIVE_INFINITY,
				newValue = Math.max(Math.min(originalValue + (incrementMagnitude * amount), max), min),
				decimalPlaces = input.step < 1 ? (input.step.substring(input.step.indexOf('.')).length - 1) : 0;

			input.value = newValue.toFixed(decimalPlaces);
			const minSelectionStart = newValue < 0 ? 2 : 1, // Move one to the right if the increment added a digit, so that incrementing again increments the same digit.
				newSelectionStart = hadValue ? Math.max(selectionStart, minSelectionStart) : input.value.length;
			input.setSelectionRange(newSelectionStart, newSelectionStart);
		},
		keys ={
			numeric: [
				[
					{ func: input => del(input, 1), label: '⌦' },
					{ lower: '7' },
					{ lower: '8' },
					{ lower: '9' },
					{ func: input => del(input, -1), label: '⌫' }
				],
				[
					{ func: input => incrementDigit(input, 1), label: '▲' },
					{ lower: '4' },
					{ lower: '5' },
					{ lower: '6', offset: -1 }
				],
				[
					{ func: input => incrementDigit(input, -1), label: '▼' },
					{ lower: '1' },
					{ lower: '2' },
					{ lower: '3' },
					{ func: enter, label: '⏎', height: 2 }
				],
				[
					{ func: input => moveCursor(input, -1), label: '←' },
					{ lower: '0' },
					{ lower: '.' },
					{ lower: '-' },
					{ func: input => moveCursor(input, 1), label: '→' }
				]
			],
			full: [
				[
					{ lower: '`', upper: '¬' },
					{ lower: '1', upper: '!' },
					{ lower: '2', upper: '"' },
					{ lower: '3', upper: '£' },
					{ lower: '4', upper: '$' },
					{ lower: '5', upper: '%' },
					{ lower: '6', upper: '^' },
					{ lower: '7', upper: '&' },
					{ lower: '8', upper: '*' },
					{ lower: '9', upper: '(' },
					{ lower: '0', upper: ')' },
					{ lower: '-', upper: '_' },
					{ lower: '=', upper: '+' },
					{ func: input => del(input, -1), label: '⌫' }
				], [
					{ lower: '	', label: '⭾', width: 1.5 },
					{ lower: 'q' },
					{ lower: 'w' },
					{ lower: 'e' },
					{ lower: 'r' },
					{ lower: 't' },
					{ lower: 'y' },
					{ lower: 'u' },
					{ lower: 'i' },
					{ lower: 'o' },
					{ lower: 'p' },
					{ lower: '[', upper: '{' },
					{ lower: ']', upper: '}' }
				], [
					{ lower: 'a' },
					{ lower: 's' },
					{ lower: 'd' },
					{ lower: 'f' },
					{ lower: 'g' },
					{ lower: 'h' },
					{ lower: 'j' },
					{ lower: 'k' },
					{ lower: 'l' },
					{ lower: ';', upper: ':' },
					{ lower: '\'', upper: '@' },
					{ lower: '#', upper: '~' },
					{ func: enter, label: '⏎', width: 2 }
				], [
					{ func: toggleShift, label: '⇧', width: 1.5, className: 'shift' },
					{ lower: '\\', upper: '|' },
					{ lower: 'z' },
					{ lower: 'x' },
					{ lower: 'c' },
					{ lower: 'v' },
					{ lower: 'b' },
					{ lower: 'n' },
					{ lower: 'm' },
					{ lower: ',', upper: '<' },
					{ lower: '.', upper: '>' },
					{ lower: '/', upper: '?' },
					{ func: toggleShift, label: '⇧', width: 1.5, className: 'shift' }
				], [
					{ func: input => moveCursor(input, -1), label: '←' },
					{ func: input => moveCursorLine(input, 1), label: '↑' },
					{ func: input => del(input, 1), label: '⌦' },
					{ lower: ' ', label: '␣', width: 8 },
					{ func: input => moveCursorLine(input, -1), label: '↓' },
					{ func: input => moveCursor(input, 1), label: '→' }
				]
			]
		},
		createKeyboard = function (keySet) {
			const container = document.createElement('div');
			container.classList.add('keyboard');
			container.classList.add(keySet);

			keys[keySet].forEach(row => {
				const rowElement = document.createElement('div');
				container.appendChild(rowElement);

				row.forEach(key => {
					const keyElement = document.createElement('button');
					keyElement.type = 'button';
					if (key.width > 1) {
						keyElement.classList.add('width-' + (key.width + '').replace('.', '-'));
					}
					if (key.height > 1) {
						keyElement.classList.add('height-' + (key.height + '').replace('.', '-'));
					}
					if (key.offset) {
						keyElement.classList.add('offset-' + (key.offset + '').replace('.', '-'));
					}
					if (key.className) {
						keyElement.classList.add(key.className);
					}
					keyElement.textContent = key.label || key.lower;
					keyElement.keyData = key;
					rowElement.appendChild(keyElement);
				});
			});

			return container;
		},
		getKeyboard = () => document.querySelector('.keyboard'),
		openKeyboard = function (keySet) {
			const keyboard = createKeyboard(keySet);

			document.querySelector('body').appendChild(keyboard);
			document.querySelector('body').classList.add('keyboard-open');

			return keyboard;
		},
		closeKeyboard = function () {
			const keyboard = getKeyboard();

			if (keyboard) {
				keyboard.parentNode.removeChild(keyboard);
				document.querySelector('body').classList.remove('keyboard-open');
			}
		},
		keyboardEnabled = function () {
			try
			{
				return JSON.parse(localStorage.getItem('enable-keyboard') || 'false');
			}
			catch (error)
			{
				// If this is being run by directly opening a local .html file, for debugging perhaps, then access to localStorage will be denied.
				// Fall back to showing the keyboard on all touchscreens.
				return ('ontouchstart' in window);
			}
		};

	document.querySelector('body').addEventListener('focusin', function (event) {
		if (keyboardEnabled() && (event.target.nodeName === 'INPUT' || event.target.nodeName === 'TEXTAREA')) {
			const input = event.target,
				inputType = event.target.nodeName === 'TEXTAREA' ? 'text' : (input.dataset.originalType || input.type),
				keyboardType = inputType === 'number' ? 'numeric' :
					inputType === 'text' ? 'full' :
					null,
				existingKeyboard = getKeyboard();

			if (!keyboardType) {
				return;
			}

			if (existingKeyboard) {
				if (existingKeyboard.classList.contains(keyboardType)) {
					return;
				} else {
					closeKeyboard();
				}
			}

			const keyboard = openKeyboard(keyboardType);

			if (input.type === 'number') {
				// Bizarrely, number inputs don't support selectionStart/End properties, so temporarily switch to a plain text input.
				input.dataset.originalType = event.target.type;
				input.type = 'text';
				// Changing type causes focus to be lost. Unfortunately, refocusing resets cursor position to the beginning.
				setTimeout(() => input.focus(), 0);
			}

			const inputBottom = input.getBoundingClientRect().bottom,
				keyboardTop = keyboard.getBoundingClientRect().top;

			if (inputBottom > keyboardTop) {
				window.scrollBy(0, inputBottom - keyboardTop);
			}
		}
	});

	document.querySelector('body').addEventListener('focusout', function (event) {
		if (event.target.nodeName === 'INPUT' || event.target.nodeName === 'TEXTAREA') {
			closeKeyboard();

			if (event.target.dataset.originalType) {
				event.target.type = event.target.dataset.originalType;
			}
		}
	});

	document.querySelector('body').addEventListener('mousedown', function (event) {
		if (event.target.nodeName === 'BUTTON' && event.target.closest('.keyboard')) {
			event.preventDefault();
			const key = event.target.keyData,
				input = document.activeElement;

			if (key.func) {
				key.func(input);
			} else if (key.lower) {
				insertChar(input, key);
			}

			event.target.classList.add('active');
		}
	});

	document.querySelector('body').addEventListener('mouseup', function (event) {
		if (event.target.nodeName === 'BUTTON' && event.target.closest('.keyboard')) {
			event.target.classList.remove('active');
		}
	});
	document.querySelector('body').addEventListener('mouseout', function (event) {
		if (event.target.nodeName === 'BUTTON' && event.target.closest('.keyboard')) {
			event.target.classList.remove('active');
		}
	});
})();
