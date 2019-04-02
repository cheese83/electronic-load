(function () {
	'use strict';
	var rawData = [],
		calculatedData = [],
		chartData = [[],[]],
		readingsTimerID,
		ajaxQueue = [],
		ajaxTimerID;
	// Helpers.
	const ajax = function (method, url, data) {
			return new Promise(function (resolve, reject) {
				const httpRequest = new XMLHttpRequest();
				httpRequest.onload  = function () {
					if (httpRequest.status < 200 || httpRequest.status >= 300) {
						reject(httpRequest.statusText);
					} else {
						const response = (httpRequest.getResponseHeader('Content-Type') === 'application/json' && httpRequest.responseText.length)
							? JSON.parse(httpRequest.responseText)
							: httpRequest.responseText;

						resolve(response);
					}
				};
				httpRequest.onerror = () => reject(httpRequest.statusText);
				
				if (method === 'GET' || method === 'HEAD') {
					const query = data
						? typeof data === 'string'
							? data.replace(/^[^\?]/, '?$&') // Prepend a '?' if the string doesn't already start with one.
							: '?' + Object.keys(data).reduce((acc, curr) => { acc.append(curr, data[curr]); return acc; }, new URLSearchParams()).toString()
						: '';
					httpRequest.open(method, url + query);
					httpRequest.send();
				} else {
					httpRequest.open(method, url);
				httpRequest.send(JSON.stringify(data));
				}
			});
		},
		// This is for the load slider, which generates requests very fast when it's moving.
		queueAjax = function (method, url, data) {
			const processQueue = function () {
					if (ajaxTimerID === undefined) {
						ajaxTimerID = setTimeout(function () {
							if (ajaxQueue.length < 1) {
								ajaxTimerID = undefined;
								return;
							}

							const args = ajaxQueue.shift();
							ajax(args.method, args.url, args.data)
								.then(function (data) {
									args.resolve();
									ajaxTimerID = undefined;
									processQueue();
								}).catch(function (error) {
									console.error(`Queued AJAX request failed (${args[0]}, ${args[1]})`, error);
									args.reject();
									ajaxTimerID = undefined;
									processQueue();
								});
						}, 0);
					}
				},
				existingIndex = ajaxQueue.findIndex(element => element.method === method && element.url === url);

			// Assume that any existing request for the same endpoint is out of date, and replace it with this one.
			if (existingIndex > -1) {
				ajaxQueue[existingIndex].resolve(); // Could store this and resolve/reject it later, but there's nowhere that that would be useful, so just resolve it now.
				ajaxQueue.splice(existingIndex, 1);
			}

			return new Promise(function (resolve, reject) {
				ajaxQueue.push({
					method: method,
					url: url,
					data: data,
					resolve: resolve,
					reject: reject
				});
				processQueue();
			});
		},
		save = function (content, filename) {
			const blob = new Blob([content], { type: 'text/plain' }),
				url = window.URL.createObjectURL(blob),
				a = document.createElement('a');

			a.download = filename;
			a.href = url;
			a.onclick = () => document.body.removeChild(a);
			document.body.appendChild(a);
			a.click();
		},
		dataAsCsv = function () {
			const values = [getXValue()].concat(getYValues().map(yValue => yValue)),
				lines = [values.map(value => value.label).join()].concat(calculatedData.map(data => values.map(value => data[value.quantity]).join()));

				return lines.join('\r\n');
		},
		valueFromRaw = function (datum, previousCalculatedDatum, quantity) {
			const coulombsToMilliampHours = 1000 / (60 * 60),
				// If this is the first datum then the period cannot be calculated. Assume it's equal to the update period instead.
				period = previousCalculatedDatum ? datum.t - previousCalculatedDatum.t : getUpdatePeriod();

			switch (quantity) {
				case 't': return datum.t;
				case 'v': return datum.v;
				case 'i': return datum.i;
				case 'p': return datum.v * datum.i;
				case 'r': return datum.v / datum.i;
				case 'q': return (previousCalculatedDatum ? previousCalculatedDatum.q : 0.0) + (datum.i * period * coulombsToMilliampHours);
				case 'e': return (previousCalculatedDatum ? previousCalculatedDatum.e : 0.0) + (datum.v * datum.i * period);
				default: return undefined;
			}
		},
		calculateFromRaw = function (datum, previousCalculatedDatum) {
			const xValue = getXValue(),
				yValues = getYValues(),
				calculated = {};

			calculated[xValue.quantity] = valueFromRaw(datum, previousCalculatedDatum, xValue.quantity);
			yValues.forEach(yValue => calculated[yValue.quantity] = valueFromRaw(datum, previousCalculatedDatum, yValue.quantity));

			//Always include time, as it is necessary for calculating subsequent values of e and q.
			if (xValue !== 't') {
				calculated['t'] = valueFromRaw(datum, previousCalculatedDatum, 't');
			}

			calculatedData.push(calculated);
			yValues.forEach((yValue, i) => chartData[i].data.push({ x: calculated[xValue.quantity], y: calculated[yValue.quantity] }));
		};
	// DOM elements.
	const startButton = document.querySelector('button[name=start]'),
		stopButton = document.querySelector('button[name=stop]'),
		saveButton = document.querySelector('button[name=save]'),
		loadInputs = {
			mode: {
				container: document.querySelector('.load-mode'),
				constant: document.querySelector('input[name=mode-type][value=constant]'),
				scripted: document.querySelector('input[name=mode-type][value=scripted]'),
				current: document.querySelector('input[name=mode-quantity][value=I]'),
				voltage: document.querySelector('input[name=mode-quantity][value=V]'),
			},
			slider: document.querySelector('input[name=load-slider]'),
			number: document.querySelector('input[name=load-number]'),
			script: document.querySelector('textarea[name=load-script]')
		},
		updatePeriodInput = document.querySelector('input[name=update-period]'),
		limitInputs = {
			i: {
				min: document.querySelector('input[name=limit-current-min]'),
				max: document.querySelector('input[name=limit-current-max]')
			},
			v: {
				min: document.querySelector('input[name=limit-voltage-min]'),
				max: document.querySelector('input[name=limit-voltage-max]')
			},
			t: {
				max: document.querySelector('input[name=limit-time-max]')
			}
		},
		calibrationInputs = {
			dac: {
				i: {
					gain: document.querySelector('input[name=calibration-dac-i-gain]'),
					offset: document.querySelector('input[name=calibration-dac-i-offset]')
				},
				v: {
					gain: document.querySelector('input[name=calibration-dac-v-gain]'),
					offset: document.querySelector('input[name=calibration-dac-v-offset]')
				}
			},
			adc: {
				i: {
					gain: document.querySelector('input[name=calibration-adc-i-gain]'),
					offset: document.querySelector('input[name=calibration-adc-i-offset]')
				},
				v: {
					gain: document.querySelector('input[name=calibration-adc-v-gain]'),
					offset: document.querySelector('input[name=calibration-adc-v-offset]')
				}
			}
		},
		chart = Chartist.Line('.chart', {}, {
			axisX: {
				type: Chartist.AutoScaleAxis,
				onlyInteger: true,
				low: 0,
				scaleMinSpace: 30,
				labelInterpolationFnc: function (value) {
					if (!chartIsOverTime()) {
						return value;
					}
					const hours = Math.floor(value / 3600),
						minutes = Math.floor((value - hours) / 60),
						seconds = value % 60;
					return `${hours ? hours + ':' : ''}${hours || minutes ? minutes.toString().padStart(hours ? 2 : 1, '0') + ':' : ''}${seconds.toString().padStart(hours || minutes ? 2 : 1, '0')}`
				}
			},
			axisY: {
				type: Chartist.AutoScaleAxis,
				low: 0
			},
			showPoint: false,
			lineSmooth: false,
			plugins: [Chartist.plugins.ctLastPointLabel()]
		});
	// Functions to read values stored in DOM.
	const isStarted = () => readingsTimerID !== undefined,
		getMode = function () {
			return {
				type: loadInputs.mode.constant.checked ? loadInputs.mode.constant.value : loadInputs.mode.scripted.value,
				quantity: loadInputs.mode.current.checked ? loadInputs.mode.current.value : loadInputs.mode.voltage.value
			};
		},
		getLimits = function () {
			return {
				i: { min: limitInputs.i.min.value, max: limitInputs.i.max.value },
				v: { min: limitInputs.v.min.value, max: limitInputs.v.max.value },
				t: { min: 0, max: limitInputs.t.max.value }
			};
		},
		getCalibrations = function () {
			return {
				dac: {
					i : { gain: calibrationInputs.dac.i.gain.value, offset: calibrationInputs.dac.i.offset.value },
					v : { gain: calibrationInputs.dac.v.gain.value, offset: calibrationInputs.dac.v.offset.value }
				},
				adc: {
					i : { gain: calibrationInputs.adc.i.gain.value, offset: calibrationInputs.adc.i.offset.value },
					v : { gain: calibrationInputs.adc.v.gain.value, offset: calibrationInputs.adc.v.offset.value }
				}
			};
		},
		getUpdatePeriod = () => updatePeriodInput.value ? parseFloat(updatePeriodInput.value) : 1.0,
		getXValue = function () {
			const input = document.querySelector('input[name=chart-x]:checked');
			return {
				quantity: input.value,
				label: input.parentNode.textContent.trim()
			};
		},
		chartIsOverTime = () => getXValue().quantity === 't',
		getYValues = function () {
			return Array.from(document.querySelectorAll('input[name=chart-y]:checked')).map(input => {
				return {
					quantity: input.value,
					label: input.parentNode.textContent.trim()
				};
			});
		};
	// Functions to update values stored in DOM.
	const setMode = function (newMode) {
			const limits = getLimits(),
				// The value read from the server may differ slightly from what was originally set because of the DAC's limited precision, rounding errors from applying calibrations, and converting from float to int and back again on the server.
				rounded = newMode.value === undefined ? undefined : newMode.value.toFixed(3);

			if (newMode.mode === 'CC') {
				loadInputs.mode.current.checked = true;
			} else {
				loadInputs.mode.voltage.checked = true;
			}

			if (newMode.script !== undefined && newMode.script !== null) {
				document.querySelectorAll('.load-value > fieldset').forEach(fieldset => fieldset.classList.toggle('selected', fieldset.classList.contains('load-value-scripted')));
				loadInputs.mode.scripted.checked = true;
				loadInputs.script.value = newMode.script;
			} else {
				document.querySelectorAll('.load-value > fieldset').forEach(fieldset => fieldset.classList.toggle('selected', fieldset.classList.contains('load-value-constant')));
				loadInputs.mode.constant.checked = true;
				loadInputs.script.value = '';
				updateSliderLimits();
				loadInputs.slider.value = rounded;
				loadInputs.number.value = loadInputs.slider.value;
			}
		},
		initChart = function () {
			const xValue = getXValue(),
				yValues = getYValues(),
				isOverTime = chartIsOverTime(),
				options = {
					showLine: isOverTime,
					showPoint: !isOverTime
				};

			calculatedData.length = 0;
			chartData = yValues.map(yValue => ({ data: [], className: 'ct-series-' + yValue.quantity }));
			rawData.forEach((data, i) => calculateFromRaw(data, i === 0 ? undefined : calculatedData[i - 1]));
			chart.update({ series: chartData }, options, true);
		},
		updateSliderLimits = function () {
			const mode = getMode(),
				limits = getLimits(),
				sliderLimits = mode.quantity === loadInputs.mode.current.value ? limits.i : limits.v;

			loadInputs.slider.setAttribute('min', sliderLimits.min);
			loadInputs.slider.setAttribute('max', sliderLimits.max);
			loadInputs.number.setAttribute('min', sliderLimits.min);
			loadInputs.number.setAttribute('max', sliderLimits.max);
		};
	// Functions to read from the server.
	const loadLimits = function () {
			return ajax('GET', 'limits').then(function (data) {
				limitInputs.i.min.value = data.i.min;
				limitInputs.i.max.value = data.i.max;
				limitInputs.v.min.value = data.v.min;
				limitInputs.v.max.value = data.v.max;
				limitInputs.t.max.value = data.t.max;

				updateSliderLimits();
			});
		},
		loadCalibrations = function () {
			return ajax('GET', 'calibrations').then(function (data) {
				calibrationInputs.dac.i.gain.value = data.dac.i.gain;
				calibrationInputs.dac.i.offset.value = data.dac.i.offset;
				calibrationInputs.dac.v.gain.value = data.dac.v.gain;
				calibrationInputs.dac.v.offset.value = data.dac.v.offset;
				calibrationInputs.adc.i.gain.value = data.adc.i.gain;
				calibrationInputs.adc.i.offset.value = data.adc.i.offset;
				calibrationInputs.adc.v.gain.value = data.adc.v.gain;
				calibrationInputs.adc.v.offset.value = data.adc.v.offset;
			});
		},
		loadLoad = function () {
			return ajax('GET', 'load')
				.then(setMode);
		},
		loadUpdatePeriod = function () {
			return ajax('GET', 'updateperiod')
				.then(data => updatePeriodInput.value = data);
		};
	// Functions that write to the server.
	const saveLimits = function () {
			return ajax('PUT', 'limits', getLimits())
				.catch(error => console.error('Failed to set limits', error));
		},
		saveCalibrations = function () {
			return ajax('PUT', 'calibrations', getCalibrations())
				.catch(error => console.error('Failed to set calibrations', error));
		},
		saveLoad = function () {
			const mode = getMode(),
				data = {
					mode: mode.quantity === loadInputs.mode.current.value ? 'CC' : 'CV',
					value: mode.type === loadInputs.mode.constant.value ? loadInputs.number.value : undefined,
					script: mode.type === loadInputs.mode.scripted.value ? loadInputs.script.value : undefined
				};

			return queueAjax('PUT', 'load', data)
				.catch(error => console.error('Failed to set load', error));
		},
		saveUpdatePeriod = function () {
			return ajax('PUT', 'updateperiod', getUpdatePeriod())
				.catch(error => console.error('Failed to set update period', error));
		},
		start = function (initialData) {
			const processData = function (data) {
					const processDatum = function (datum) {
							if (rawData.length && datum.t <= rawData[rawData.length - 1].t) {
								return false;
							} else {
								rawData.push(datum);
								calculateFromRaw(datum, calculatedData.length ? calculatedData[calculatedData.length - 1] : undefined);
								return true;
							}
						},
						updatePeriod = getUpdatePeriod(),
						minUpdatePeriod = 0.2; // No point updating faster than this.

					if (data.length) {
						if (data.reduce((processedAny, datum) => processDatum(datum) || processedAny, false)) {
							chart.update({ series: chartData });
						}

						const lastDatum = data[data.length - 1];
						if (lastDatum.stopped) {
							stop();
						} else if (isStarted()) {
							// Wait until just after the next reading is due.
							readingsTimerID = setTimeout(loadReadings, Math.max(Math.max(updatePeriod - lastDatum.age, 0.0) + 0.1, minUpdatePeriod) * 1000.0);
						}
					} else if (isStarted()) {
						// It's possible that the server wasn't ready by the time the first request was made. Try again in a little while.
						readingsTimerID = setTimeout(loadReadings, updatePeriod * 1000.0);
					}
				},
				loadReadings = function () {
					const lastTime = rawData.length ? rawData[rawData.length - 1].t : undefined;
					ajax('GET', 'iv', lastTime ? { since: lastTime } : undefined).then(processData).catch(function (error) {
						console.error('Failed to read from ADC', error);
						stop();
					});
				};

			if (isStarted()) {
				return;
			}

			if (initialData) {
				rawData.length = 0;
				initChart();
				if (initialData.length) {
					// Pretend that the data came from the normal timer process so that processData loops if the data isn't flagged as stopped.
					readingsTimerID = 0;
					startButton.setAttribute('disabled', '');
					stopButton.removeAttribute('disabled');
					console.log('Resuming.');
					processData(initialData);
				}
			} else {
				rawData.length = 0;
				initChart();
				startButton.setAttribute('disabled', '');
				stopButton.removeAttribute('disabled');
				saveLoad()
					.then(saveUpdatePeriod)
					.then(saveLimits)
					.then(() => ajax('POST', 'start'))
					.then(data => console.log('Started at ' + data))
					.catch(error => console.error('Failed to start', error));
				readingsTimerID = setTimeout(loadReadings, Math.max((getUpdatePeriod() + 0.1) * 1000.0));
			}
		},
		stop = function () {
			startButton.removeAttribute('disabled');
			stopButton.setAttribute('disabled', '');

			if (isStarted()) {
				ajax('POST', 'stop')
					.then(data => console.log('Stopped at ' + data))
					.catch(error => console.error('Failed to stop', error));

				clearTimeout(readingsTimerID);
				readingsTimerID = undefined;
			}
		};

		document.querySelector('.tabs').addEventListener('click', function (event) {
			if (event.target.nodeName !== 'LABEL') {
				return;
			}

			const tabIndex = Array.from(event.target.parentElement.children).indexOf(event.target) + 1;
			event.target.parentElement.querySelectorAll('label').forEach(label => label.classList.remove('selected'));
			event.target.classList.add('selected');
			event.target.parentElement.parentElement.querySelectorAll('.tabbed > fieldset').forEach(tab => tab.classList.remove('selected'));
			event.target.parentElement.parentElement.querySelector('.tabbed > fieldset:nth-of-type(' + tabIndex +')').classList.add('selected');
		});

		startButton.addEventListener('click', event => start());
		stopButton.addEventListener('click', event => stop());
		saveButton.addEventListener('click', event => save(dataAsCsv(), 'data.csv'));

		document.querySelector('.chart-options').addEventListener('change', event => initChart());

		document.querySelector('.calibration').addEventListener('change', saveCalibrations);

		document.querySelector('.limits').addEventListener('change', function (event) {
			saveLimits();
			updateSliderLimits();
		});

		loadInputs.mode.container.addEventListener('change', function (event) {
			const mode = getMode();
			if (event.target.name === loadInputs.mode.constant.name) {
				setMode({
					mode: mode.quantity === loadInputs.mode.current.value ? 'CC' : 'CV',
					value: mode.type === loadInputs.mode.constant.value ? parseFloat(loadInputs.slider.value) : undefined,
					script: mode.type === loadInputs.mode.scripted.value ? loadInputs.script.value : undefined
				});
			} else if (event.target.name === loadInputs.mode.current.name) {
				const limits = getLimits(),
					value = event.target.value === loadInputs.mode.current.value ? limits.i.min : limits.v.max;
				setMode({
					mode: mode.quantity === loadInputs.mode.current.value ? 'CC' : 'CV',
					value: mode.type === loadInputs.mode.constant.value ? parseFloat(value) : undefined,
					script: mode.type === loadInputs.mode.scripted.value ? loadInputs.script.value : undefined
				});
			}
		});
		loadInputs.slider.addEventListener('input', function () {
			loadInputs.number.value = loadInputs.slider.value;
			saveLoad();
		});
		loadInputs.number.addEventListener('change', function () {
			loadInputs.slider.value = loadInputs.number.value;
			saveLoad();
		});
		loadInputs.script.addEventListener('change', saveLoad);

		updatePeriodInput.addEventListener('change', saveUpdatePeriod);

		document.querySelector('button[name=shutdown]').addEventListener('click', function (event) {
			ajax('POST', 'shutdown');
		});

		document.querySelector('.brightness').addEventListener('click', function (event) {
			if (event.target.name !== 'brightness') {
				return;
			}

			ajax('POST', `brightness/${event.target.value}`)
				.catch(error => console.error('Failed to set brightness.', error));
		});

		document.querySelector('button[name=test-chart]').addEventListener('click', function (event) {
			var i;
			rawData.length = 0;
			for (i = 0; i < 60; i++) {
				rawData.push({
					t: i,
					i: 1 + (Math.sin(i) * 0.01) + (Math.random() * 0.01),
					v: 1.5 + (Math.random() * 0.002 * i) + (0.005 * i),
					age: 0.01
				});
			}
			initChart();
		});

		document.querySelector('input[name=enable-keyboard]').addEventListener('change', function (event) {
			localStorage.setItem('enable-keyboard', event.target.checked);
		});
		document.querySelector('input[name=enable-keyboard]').checked = JSON.parse(localStorage.getItem('enable-keyboard') || 'false');

		loadCalibrations()
			.then(loadLimits)
			.then(loadUpdatePeriod)
			.then(loadLoad)
			.then(() => ajax('GET', 'iv'))
			.then(data => start(data))
			.catch(error => console.error('Failed to load initial data from server.', error));
})();
