/*
   Activity that displays the about page

   Copyright 2013 Thincast Technologies GmbH, Author: Martin Fleisz

   This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
   If a copy of the MPL was not distributed with this file, You can obtain one at
   http://mozilla.org/MPL/2.0/.
*/

package com.freerdp.freerdpcore.presentation;

import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import com.freerdp.freerdpcore.R;
import com.freerdp.freerdpcore.services.LibFreeRDP;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Locale;

public class AboutActivity extends AppCompatActivity
{
	private static final String TAG = AboutActivity.class.toString();
	private WebView mWebView;

	@Override protected void onCreate(Bundle savedInstanceState)
	{
		super.onCreate(savedInstanceState);
		setContentView(R.layout.activity_about);

		if (getSupportActionBar() != null)
			getSupportActionBar().setDisplayHomeAsUpEnabled(true);

		mWebView = findViewById(R.id.activity_about_webview);

		WebSettings settings = mWebView.getSettings();
		settings.setDomStorageEnabled(true);
		settings.setUseWideViewPort(true);
		settings.setLoadWithOverviewMode(true);
		settings.setSupportZoom(true);

		mWebView.setWebViewClient(new WebViewClient() {
			@Override public boolean shouldOverrideUrlLoading(WebView view, String url)
			{
				if (url.startsWith("file:///android_asset/"))
				{
					view.loadUrl(url);
					return true;
				}
				return false;
			}
		});

		populate();
	}

	@Override public boolean onSupportNavigateUp()
	{
		finish();
		return true;
	}

	private void populate()
	{
		String filename = "about_phone.html";
		if ((getResources().getConfiguration().screenLayout &
		     Configuration.SCREENLAYOUT_SIZE_MASK) >= Configuration.SCREENLAYOUT_SIZE_LARGE)
			filename = "about.html";

		Locale def = Locale.getDefault();
		String prefix = def.getLanguage().toLowerCase(def);
		String dir = prefix + "_about_page/";
		String file = dir + filename;

		try
		{
			InputStream is = getAssets().open(file);
			is.close();
		}
		catch (IOException e)
		{
			Log.d(TAG, "No localized asset " + file + ", falling back to default");
			dir = "about_page/";
			file = dir + filename;
		}

		StringBuilder total = new StringBuilder();
		try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open(file))))
		{
			String line;
			while ((line = r.readLine()) != null)
			{
				total.append(line);
				total.append("\n");
			}
		}
		catch (IOException e)
		{
			Log.e(TAG, "Could not read about page " + file, e);
		}

		String version;
		try
		{
			version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
		}
		catch (PackageManager.NameNotFoundException e)
		{
			version = "unknown";
		}
		version = version + " (" + LibFreeRDP.getVersion() + ")";

		final String base = "file:///android_asset/" + dir;
		final String html = total.toString()
		                        .replaceAll("%AFREERDP_VERSION%", version)
		                        .replaceAll("%SYSTEM_VERSION%", Build.VERSION.RELEASE)
		                        .replaceAll("%DEVICE_MODEL%", Build.MODEL);

		mWebView.loadDataWithBaseURL(base, html, "text/html", null, "about:blank");
	}
}
