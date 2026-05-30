/*
   Activity that displays the help pages

   Copyright 2013 Thincast Technologies GmbH, Author: Martin Fleisz

   This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
   If a copy of the MPL was not distributed with this file, You can obtain one at
   http://mozilla.org/MPL/2.0/.
*/

package com.freerdp.freerdpcore.presentation;

import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import com.freerdp.freerdpcore.R;

import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

public class HelpActivity extends AppCompatActivity
{
	private static final String TAG = HelpActivity.class.toString();
	private WebView mWebView;

	@Override public void onCreate(Bundle savedInstanceState)
	{
		super.onCreate(savedInstanceState);
		setContentView(R.layout.activity_help);

		if (getSupportActionBar() != null)
			getSupportActionBar().setDisplayHomeAsUpEnabled(true);

		mWebView = findViewById(R.id.activity_help_webview);

		WebSettings settings = mWebView.getSettings();
		settings.setDomStorageEnabled(true);
		settings.setUseWideViewPort(true);
		settings.setLoadWithOverviewMode(true);
		settings.setSupportZoom(true);
		settings.setJavaScriptEnabled(true);
		settings.setAllowContentAccess(true);
		settings.setAllowFileAccess(true);

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
		String filename;
		if ((getResources().getConfiguration().screenLayout &
		     Configuration.SCREENLAYOUT_SIZE_MASK) >= Configuration.SCREENLAYOUT_SIZE_LARGE)
			filename = "gestures.html";
		else
			filename = "gestures_phone.html";

		Locale def = Locale.getDefault();
		String prefix = def.getLanguage().toLowerCase(def);
		String dir = prefix + "_help_page/";
		String file = dir + filename;

		try
		{
			InputStream is = getAssets().open(file);
			is.close();
		}
		catch (IOException e)
		{
			Log.d(TAG, "No localized asset " + file + ", falling back to default");
			dir = "help_page/";
			file = dir + filename;
		}

		mWebView.loadUrl("file:///android_asset/" + file);
	}
}
