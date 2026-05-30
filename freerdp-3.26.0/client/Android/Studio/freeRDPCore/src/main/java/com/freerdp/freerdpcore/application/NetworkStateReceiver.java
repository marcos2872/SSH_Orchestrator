/*
   Network State Receiver

   Copyright 2013 Thincast Technologies GmbH, Author: Martin Fleisz

   This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
   If a copy of the MPL was not distributed with this file, You can obtain one at
   http://mozilla.org/MPL/2.0/.
*/

package com.freerdp.freerdpcore.application;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

public class NetworkStateReceiver
{
	private static final String TAG = "NetworkStateReceiver";

	public static boolean isMeteredNetwork(Context context)
	{
		ConnectivityManager cm =
		    (ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
		return cm != null && cm.isActiveNetworkMetered();
	}

	public static void registerNetworkCallback(Context context)
	{
		ConnectivityManager cm =
		    (ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
		if (cm == null)
			return;

		ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
			private void update(String event)
			{
				GlobalApp.IsMeteredNetwork = isMeteredNetwork(context);
				Log.d(TAG, event + " - IsMeteredNetwork=" + GlobalApp.IsMeteredNetwork);
			}

			@Override
			public void onCapabilitiesChanged(@NonNull Network n, @NonNull NetworkCapabilities c)
			{
				update("Capabilities Changed");
			}
			@Override public void onAvailable(@NonNull Network n)
			{
				update("Available");
			}
			@Override public void onLost(@NonNull Network n)
			{
				update("Lost");
			}
		};

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
			cm.registerDefaultNetworkCallback(callback);
		else
			cm.registerNetworkCallback(new NetworkRequest.Builder().build(), callback);
	}
}
